# OCI remediation — deploy order and staging proofs

## Deploy order (blue/green)

1. Apply Supabase migration via MCP `apply_migration` (repo file: `supabase/migrations/20261226000000_oci_transition_grants_revoke_apply_call_action_strict.sql`).
2. Apply blocked-metadata snapshot remediation: `supabase/migrations/20261226021000_oci_snapshot_batch_blocked_metadata_and_assert.sql` (restores `block_reason` / `blocked_at` clearing in `apply_snapshot_batch` / assert parity vs Phase 23 ledger).
3. Apply forward grant re-assert (no function body changes): `supabase/migrations/20261226022000_oci_transition_rpc_grants_service_role_only.sql` — idempotent `REVOKE` from `PUBLIC` / `anon` / `authenticated` and `GRANT EXECUTE … TO service_role` on OCI transition and snapshot RPCs (belt-and-suspenders for partial applies or stray manual grants).
4. Deploy Next.js app (panel routes, ACK clock, cron/worker JSON fields).
5. Rotate Google Ads Script Properties (`OPSMANTIK_API_KEY`, `OPSMANTIK_SITE_ID`); redeploy scripts **after** API is live.

## Release minimum checks

Deploy blocker command:

```bash
npm run test:release-gates
```

Current required set:
- `test:tenant-boundary`
- `test:oci-kernel`
- `test:runtime-budget`
- `test:chaos-core`
- `smoke:oci-rollout-readiness:strict`

`smoke:intent-multi-site` is optional (diagnostic only).

## Staging SQL checks (read-only)

- **Grants:** After migration, `anon` must not gain new broad table grants on `oci_queue_transitions`; ledger RPCs remain `service_role`-gated inside function bodies.
- **Pre-dedupe:** `SELECT count(*) FROM outbox_events WHERE status='PENDING' GROUP BY site_id, call_id, payload->>'stage' HAVING count(*)>1` should return **0 rows**.
- **Merged child:** For `calls.merged_into_call_id IS NOT NULL`, confirm no new `outbox_events` / `marketing_signals` / `offline_conversion_queue` rows in test window (site-scoped).
- **DB Guard: OCI conversion time zero-tolerance (fail-closed):** confirm trigger/functions exist and overwrite conversion timestamps from `calls.created_at`.

```sql
-- 1) Trigger presence
SELECT tgname, event_manipulation, event_object_table
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE t.tgname IN (
  'trg_enforce_oci_queue_conversion_time_from_call_created_at',
  'trg_enforce_marketing_signal_time_from_call_created_at'
)
ORDER BY tgname;

-- 2) Function presence
SELECT proname
FROM pg_proc
WHERE proname IN (
  'enforce_oci_queue_conversion_time_from_call_created_at',
  'enforce_marketing_signal_time_from_call_created_at'
)
ORDER BY proname;

-- 3) Trigger timing + scope sanity (BEFORE/AFTER, ROW/STATEMENT, INSERT/UPDATE)
-- tgtype bits: 1=ROW, 2=STATEMENT, 4=INSERT, 16=UPDATE, 64=BEFORE, 128=AFTER
SELECT
  tgname,
  tgtype,
  (tgtype & 1)   <> 0 AS is_row,
  (tgtype & 2)   <> 0 AS is_statement,
  (tgtype & 4)   <> 0 AS fires_on_insert,
  (tgtype & 16)  <> 0 AS fires_on_update,
  (tgtype & 64)  <> 0 AS is_before,
  (tgtype & 128) <> 0 AS is_after
FROM pg_trigger
WHERE tgname IN (
  'trg_enforce_oci_queue_conversion_time_from_call_created_at',
  'trg_enforce_marketing_signal_time_from_call_created_at'
)
ORDER BY tgname;

-- 4) Proof that overwrite uses calls.created_at (inspect definitions)
SELECT pg_get_functiondef(p.oid) AS fn_def
FROM pg_proc p
WHERE p.proname IN (
  'enforce_oci_queue_conversion_time_from_call_created_at',
  'enforce_marketing_signal_time_from_call_created_at'
)
ORDER BY p.proname;
```

## Blocked precursor queue metadata (`BLOCKED_PRECEEDING_SIGNALS`)

Forward migration (restores `block_reason` / `blocked_at` handling in `apply_snapshot_batch`; required for promotion parity):
- `supabase/migrations/20261226021000_oci_snapshot_batch_blocked_metadata_and_assert.sql`

Promotion path (runtime): `lib/oci/promote-blocked-queue.ts` → `append_worker_transition_batch_v2` with `clear_fields: ['block_reason','blocked_at']`.

Additional **service_role** exception (ops / panel reset): `append_manual_transition_batch` / `RESET_TO_QUEUED` in `20260503100100_oci_snapshot_and_manual_blocked_clear.sql` also appends `clear_fields` when moving to `QUEUED`; it uses the same snapshot kernel.

### Blocked-status spelling inventory (runtime truth)

English “preceding” is occasionally misspelled as “preceeding” in identifiers. Ops queries and remediation SQL must match **whatever spelling actually exists** in `offline_conversion_queue.status` (this doc uses `BLOCKED_PRECEEDING_SIGNALS` elsewhere as the intended spelling; prove it before relying on literals).

Run on the environment (read-only):

```sql
SELECT status, count(*)
FROM public.offline_conversion_queue
WHERE status ILIKE 'BLOCKED%SIGNALS'
GROUP BY status
ORDER BY status;
```

- If exactly one row is returned (or one dominates), treat that literal as **`<CANONICAL_BLOCKED_STATUS>`** for downstream drift queries and runbook filters.
- If two spellings appear, treat both as data issues: reconcile code/migrations separately (out of scope for this inventory query).

Parameterized drift checks (substitute `<CANONICAL_BLOCKED_STATUS>` with the value from the inventory above):

```sql
SELECT count(*) AS stale_block_reason_count
FROM public.offline_conversion_queue
WHERE status <> '<CANONICAL_BLOCKED_STATUS>'
  AND block_reason IS NOT NULL;

SELECT count(*) AS stale_blocked_at_count
FROM public.offline_conversion_queue
WHERE status <> '<CANONICAL_BLOCKED_STATUS>'
  AND blocked_at IS NOT NULL;
```

### Evidence (read-only drift detection)

```sql
-- Rows that left BLOCKED but still carry a block_reason (should be 0 after fix + healthy promotion)
SELECT count(*) AS drift_block_reason
FROM public.offline_conversion_queue
WHERE status IS DISTINCT FROM 'BLOCKED_PRECEEDING_SIGNALS'
  AND status IS NOT NULL
  AND block_reason IS NOT NULL;

-- Rows that left BLOCKED but still carry blocked_at (should be 0 after fix + healthy promotion)
SELECT count(*) AS drift_blocked_at
FROM public.offline_conversion_queue
WHERE status IS DISTINCT FROM 'BLOCKED_PRECEEDING_SIGNALS'
  AND status IS NOT NULL
  AND blocked_at IS NOT NULL;
```

### Repair (maintenance window only — run only when evidence counts > 0)

Blind cleanup is **not** automated in migrations. If drift is confirmed, clear metadata only for rows that are **not** still blocked:

```sql
-- Preview first
SELECT id, site_id, status, block_reason, blocked_at
FROM public.offline_conversion_queue
WHERE status IS DISTINCT FROM 'BLOCKED_PRECEEDING_SIGNALS'
  AND status IS NOT NULL
  AND (block_reason IS NOT NULL OR blocked_at IS NOT NULL)
LIMIT 50;

-- Apply (example — adjust site scope / batch as needed)
BEGIN;
UPDATE public.offline_conversion_queue
SET
  block_reason = NULL,
  blocked_at = NULL,
  updated_at = now()
WHERE status IS DISTINCT FROM 'BLOCKED_PRECEEDING_SIGNALS'
  AND status IS NOT NULL
  AND (block_reason IS NOT NULL OR blocked_at IS NOT NULL);
COMMIT;
```

## Remote DB proof (MCP evidence)

Latest hardening verification (via `list_migrations` + `execute_sql`):
- hardening migration present remotely as `oci_transition_grants_revoke_apply_call_action_strict`.
- `idx_outbox_events_pending_site_call_stage_uq` exists in `public.outbox_events`.
- transition RPC EXECUTE privileges limited to `service_role` (plus `postgres` owner role).
- `oci_queue_transitions` and `oci_payload_validation_events` grants include `service_role`; no `anon/authenticated` table grants.
- conversion-time DB guard migration present remotely as `oci_conversion_time_zero_tolerance_db_guard` (trigger overwrites `offline_conversion_queue` + `marketing_signals` timestamps from `calls.created_at`).
- blocked-metadata snapshot migration present remotely as `oci_snapshot_batch_blocked_metadata_and_assert` (`apply_snapshot_batch` once again applies `clear_fields` / explicit `BLOCKED_PRECEEDING_SIGNALS` → `QUEUED` clearing for `block_reason` + `blocked_at`).
- transition RPC grant re-assert migration present remotely as `oci_transition_rpc_grants_service_role_only` (see `20261226022000_oci_transition_rpc_grants_service_role_only.sql`).

## Load / soak (targets are calibrated per environment)

- N parallel `POST /api/intents/[id]/stage` on the same `call_id` within 1s: expect bounded PENDING rows (index + 23505 idempotent path); worker p95 within prior baseline.
