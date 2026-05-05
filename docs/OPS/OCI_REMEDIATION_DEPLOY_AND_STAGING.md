# OCI remediation — deploy order and staging proofs

## Deploy order (blue/green)

1. Apply Supabase migration via MCP `apply_migration` (repo file: `supabase/migrations/20261226000000_oci_transition_grants_revoke_apply_call_action_strict.sql`).
2. Deploy Next.js app (panel routes, ACK clock, cron/worker JSON fields).
3. Rotate Google Ads Script Properties (`OPSMANTIK_API_KEY`, `OPSMANTIK_SITE_ID`); redeploy scripts **after** API is live.

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

## Remote DB proof (MCP evidence)

Latest hardening verification (via `list_migrations` + `execute_sql`):
- hardening migration present remotely as `oci_transition_grants_revoke_apply_call_action_strict`.
- `idx_outbox_events_pending_site_call_stage_uq` exists in `public.outbox_events`.
- transition RPC EXECUTE privileges limited to `service_role` (plus `postgres` owner role).
- `oci_queue_transitions` and `oci_payload_validation_events` grants include `service_role`; no `anon/authenticated` table grants.

## Load / soak (targets are calibrated per environment)

- N parallel `POST /api/intents/[id]/stage` on the same `call_id` within 1s: expect bounded PENDING rows (index + 23505 idempotent path); worker p95 within prior baseline.
