# OPS remediation — evidence pack (completed chain)

<!-- Artifact: collect verification evidence for implemented remediation; no new runtime features. -->

This document consolidates **verification evidence** for the remediation chain already merged in-repo. Use it for staging sign-off and production go/no-go reviews.

---

## 1. Completed remediation list

| Track | Summary | Primary artifacts |
|---|---|---|
| **P0-A** — `append_worker_transition_batch_v2` migration authority | Worker RPC defined in-repo with `service_role` gate + grants; contract tests pin migration + callsites. | `supabase/migrations/20261226020000_create_append_worker_transition_batch_v2.sql`, `tests/unit/append-worker-transition-batch-v2-contracts.test.ts` |
| **P0-B** — Call-event v1/v2 signature parity | Shared signature policy helper used by both routes; matrix tests for invalid sig / verifier missing / dev bypass rules. | `lib/security/call-event-signature-policy.ts`, `app/api/call-event/**`, `tests/unit/call-event-signature-policy-parity.test.ts` |
| **P1-A** — ACK / ACK_FAILED signature parity | Shared ACK policy; compat vs required modes; parity tests. | `lib/security/oci-ack-signature-policy.ts`, `tests/unit/ack-signature-parity.test.ts`, `tests/unit/ack-jws-enforcement-contract.test.ts` |
| **P1-B** — Blocked metadata lifecycle | Snapshot kernel restores `block_reason` / `blocked_at` clearing on promotion paths; assert parity vs ledger where applicable. | `supabase/migrations/20261226021000_oci_snapshot_batch_blocked_metadata_and_assert.sql`, `tests/unit/blocked-preceding-promotion-metadata-contract.test.ts` |
| **Transition RPC grant cleanup** | Forward `REVOKE` from `PUBLIC` / `anon` / `authenticated` + `GRANT EXECUTE … TO service_role` on privileged OCI transition/snapshot RPCs (belt-and-suspenders after earlier hardening). | `supabase/migrations/20261226022000_oci_transition_rpc_grants_service_role_only.sql`, `supabase/migrations/20261226000000_oci_transition_grants_revoke_apply_call_action_strict.sql`, `tests/unit/oci-transition-rpc-grants-service-role-only.test.ts`, `tests/unit/oci-rpc-grants-hardening.test.ts` |
| **M1** — Status API contract | `/api/intents/[id]/status` documents executable vs unsupported vs invalid; structured `4xx` with `UNSUPPORTED_STATUS` / `INVALID_STATUS`. | `lib/api/intent-status-route-contract.ts`, `app/api/intents/[id]/status/route.ts`, `tests/unit/intent-status-api-contract.test.ts`, `tests/unit/intent-lifecycle-route-contract.test.ts` |
| **M2** — Status taxonomy SSOT + merged / won clarification | `status-taxonomy.ts` + parity matrix table; **won** aligned as session-reuse terminal; **merged** clarified as non–`calls.status` CHECK / use `merged_into_call_id`. | `lib/domain/intents/status-taxonomy.ts`, `docs/OPS/INTENT_RUNTIME_PARITY_MATRIX.md`, `tests/unit/status-taxonomy-contract.test.ts`, `lib/intents/session-reuse-v1.ts` (comments), `lib/ingest/process-call-event.ts` (header comment) |

---

## 2. Test evidence

Run from repository root. **Expected:** every command exits **0** and TAP reports **pass** for all listed tests.

### Aggregate gates

```bash
npm run test:oci-kernel
```

**Expected:** all listed OCI kernel unit/architecture tests pass; trailing `npm run verify:oci-spine` prints **`[verify-oci-spine] OK`**.

```bash
npm run test:unit
```

**Expected:** full `tests/unit/*.test.ts` sweep passes (includes taxonomy, intent status, grants, call-event, ACK, blocked metadata contracts among others).

```bash
npm run smoke:intent-multi-site
```

**Expected:** script completes successfully (multi-site intent smoke).

### Targeted unit tests (remediation-focused)

```bash
node --import tsx --test tests/unit/append-worker-transition-batch-v2-contracts.test.ts
node --import tsx --test tests/unit/call-event-signature-policy-parity.test.ts
node --import tsx --test tests/unit/ack-signature-parity.test.ts
node --import tsx --test tests/unit/ack-jws-enforcement-contract.test.ts
node --import tsx --test tests/unit/blocked-preceding-promotion-metadata-contract.test.ts
node --import tsx --test tests/unit/oci-transition-rpc-grants-service-role-only.test.ts
node --import tsx --test tests/unit/oci-rpc-grants-hardening.test.ts
node --import tsx --test tests/unit/intent-status-api-contract.test.ts
node --import tsx --test tests/unit/intent-lifecycle-route-contract.test.ts
node --import tsx --test tests/unit/status-taxonomy-contract.test.ts
node --import tsx --test tests/unit/session-reuse-v1.test.ts
```

**Expected:** each file exits **0**; subtests **ok**.

---

## 3. Staging SQL evidence queries

Execute read-only on a staging replica unless explicitly applying repairs.

### 3.1 `append_worker_transition_batch_v2` existence + signature

```sql
SELECT
  p.oid::regprocedure AS regproc,
  pg_get_function_identity_arguments(p.oid) AS identity_args,
  l.lanname AS language,
  p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND p.proname = 'append_worker_transition_batch_v2';
```

**Expected:** one row; identity args match migration:  
`uuid[], text, timestamptz, jsonb` (order as defined in `20261226020000_create_append_worker_transition_batch_v2.sql`).

### 3.2 Transition RPC privileges (least privilege)

Spot-check grants via catalog (adjust routine list as needed). Example for worker + snapshot kernel entrypoints:

```sql
SELECT
  routine_name,
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'append_worker_transition_batch_v2',
    'apply_snapshot_batch',
    'assert_latest_ledger_matches_snapshot',
    'append_manual_transition_batch',
    'queue_transition_payload_has_meaningful_patch'
  )
ORDER BY routine_name, grantee;
```

**Expected evidence:**

- **`service_role`** has **`EXECUTE`** (and/or superseding privileges consistent with `GRANT EXECUTE`) on required RPCs.
- **`anon`**, **`authenticated`**, and **`PUBLIC`** must **not** appear with executable privileges on these RPCs after migrations **`20261226000000_*`** + **`20261226022000_*`** (+ authoritative definitions in older migrations).

For deeper ACL inspection (optional):

```sql
SELECT
  c.relname,
  c.relacl::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('oci_queue_transitions', 'oci_payload_validation_events');
```

**Expected:** table ACLs align with service-role–scoped access described in `20261226000000_oci_transition_grants_revoke_apply_call_action_strict.sql`.

### 3.3 BLOCKED status spelling inventory

```sql
SELECT status, count(*) AS row_count
FROM public.offline_conversion_queue
WHERE status ILIKE 'BLOCKED%SIGNALS'
GROUP BY status
ORDER BY status;
```

**Expected:** use the dominant literal as **`<CANONICAL_BLOCKED_STATUS>`** for drift queries (resolve **`BLOCKED_PRECEEDING_SIGNALS`** vs typo variant before hardcoding runbooks).

### 3.4 Stale `block_reason` / `blocked_at` drift (parameterized)

Replace `<CANONICAL_BLOCKED_STATUS>` with the value proven in §3.3.

```sql
SELECT count(*) AS stale_block_reason_count
FROM public.offline_conversion_queue
WHERE status IS DISTINCT FROM '<CANONICAL_BLOCKED_STATUS>'
  AND status IS NOT NULL
  AND block_reason IS NOT NULL;

SELECT count(*) AS stale_blocked_at_count
FROM public.offline_conversion_queue
WHERE status IS DISTINCT FROM '<CANONICAL_BLOCKED_STATUS>'
  AND status IS NOT NULL
  AND blocked_at IS NOT NULL;
```

**Expected:** **0** in healthy promotion paths post–P1-B; non-zero requires investigation / approved maintenance (see `docs/OPS/OCI_REMEDIATION_DEPLOY_AND_STAGING.md`).

### 3.5 Optional — blocked promotion smoke (read-only counts)

```sql
SELECT status, count(*) AS n
FROM public.offline_conversion_queue
WHERE status ILIKE 'BLOCKED%' OR status ILIKE 'QUEUED%'
GROUP BY status
ORDER BY status;
```

Use only as a staging sanity snapshot alongside application logs for `append_worker_transition_batch_v2` promotions.

---

## 4. Route smoke matrix (manual / API expectations)

Document **expected HTTP / behavior** (exact status codes may vary by middleware). Align with unit contracts in `tests/unit/call-event-signature-policy-parity.test.ts`, `tests/unit/ack-signature-parity.test.ts`, `tests/unit/ack-jws-enforcement-contract.test.ts`.

| Scenario | Expected |
|---|---|
| Call-event **v1** invalid signature | Rejected when policy requires verification; parity with v2 behavior baseline. |
| Call-event **v2** invalid signature | Same policy outcome class as v1 (fail-closed where enforced). |
| Call-event **v1/v2** verifier unavailable (`verify_call_event_signature_v1` missing / error) | **Fail-closed** (503-class) in production-style paths; tests lock parity. |
| Call-event **v1/v2** dev bypass | Allowed **only** non-production + explicit env flag; disabled in production. |
| ACK **unsigned**, compatibility mode | Unsigned API-key path remains **allowed** where compat flag permits. |
| ACK_FAILED **unsigned**, compatibility mode | Same compat behavior class as ACK (policy helper). |
| ACK **unsigned**, require-signature mode | **Rejected** (unsigned not allowed). |
| ACK_FAILED **unsigned**, require-signature mode | **Rejected**. |
| ACK / ACK_FAILED **bad signature** | **Rejected** when signature present but invalid. |
| ACK / ACK_FAILED **require-signature + missing `VOID_PUBLIC_KEY` (or verifier config)** | **Fail-closed** / misconfiguration path per policy tests. |

---

## 5. Status contract evidence

| Topic | Evidence |
|---|---|
| **`POST /api/intents/[id]/status` accepted (executable)** | Body `status` (normalized): **`junk`**, **`cancelled`**, **`intent`** — see `lib/api/intent-status-route-contract.ts`. |
| **Rejected unsupported (recognized)** | **`confirmed`**, **`qualified`**, **`real`**, **`suspicious`** → **`UNSUPPORTED_STATUS`** + structured JSON. |
| **Invalid** | Missing/empty/unknown strings (e.g. **`won`**, **`contacted`**, **`offered`**) → **`INVALID_STATUS`** (fast reject before call load where applicable). |
| **`cancelled` → `junk` compatibility** | Route maps HTTP **`cancelled`** to RPC stage **`junk`**; persists **`calls.status = 'junk'`**, not DB enum **`cancelled`**, for this endpoint’s compat path. |
| **`won` terminal for session reuse** | `TERMINAL_STATUSES` in `lib/intents/session-reuse-v1.ts` includes **`won`**; `shouldReuseSessionV1` returns **`terminal_status`**. Locked by `tests/unit/session-reuse-v1.test.ts` + `tests/unit/status-taxonomy-contract.test.ts`. |
| **Merged archival** | Canonical merge is **`calls.merged_into_call_id`**; OCI producer skips via that column. **`calls.status = 'merged'`** is **not** in current `calls_status_check`. |

---

## 6. Deployment checklist

1. **Apply migrations** via Supabase MCP **`apply_migration`** in dependency order (including at minimum):  
   - `20261226000000_oci_transition_grants_revoke_apply_call_action_strict.sql`  
   - `20261226020000_create_append_worker_transition_batch_v2.sql`  
   - `20261226021000_oci_snapshot_batch_blocked_metadata_and_assert.sql`  
   - `20261226022000_oci_transition_rpc_grants_service_role_only.sql`  
   (Plus any prerequisite migrations already in chain — follow repo order.)
2. **Run tests:** `npm run test:oci-kernel`, `npm run test:unit`, and targeted tests in §2.
3. **Run staging SQL** evidence in §3 (grants + BLOCKED inventory + drift counts).
4. **Run** `npm run smoke:intent-multi-site`.
5. **Monitor 30–60 minutes** post-production deploy: outbox drain rates, OCI worker errors, panel mutation 4xx/5xx, ACK rejection spikes, conversion upload retries.

---

## 7. Remaining risks

### Must do before prod

- **Migration apply completeness:** all OCI transition / snapshot / worker RPC migrations present remotely; partial applies resurrect broad grants or missing RPCs.
- **Grant verification:** SQL in §3.2 proves **`anon` / `authenticated` / `PUBLIC`** lack EXECUTE on privileged transition RPCs.
- **`VOID_PUBLIC_KEY` / verifier availability** wherever call-event + ACK signature modes are **required**.

### Should do soon

- Resolve **`merged`** string drift vs DDL (`calls_status_check` does not list **`merged`**; SQL still references defensively — align documentation + eventual DDL or remove dead branches).
- **BLOCKED spelling** canonicalization after inventory query if two literals coexist in data.
- **Stale blocked metadata** counts non-zero → execute approved maintenance per runbook.

### Nice to have

- Extended **smoke** coverage for multi-region latency + idempotent replay storms.
- Dashboard tiles for **grant drift** / periodic **`information_schema.routine_privileges`** audits.

---

## 8. Go / no-go checklist

Production may proceed **only if**:

- [ ] **All P0/P1 automated gates pass** — at minimum `npm run test:oci-kernel` and full `npm run test:unit` green on the release artifact.
- [ ] **SQL grants prove least privilege** — §3.2 evidence captured; no unexpected **`anon` / `authenticated` / PUBLIC** EXECUTE on listed RPCs.
- [ ] **`npm run smoke:intent-multi-site` passes** on staging (or equivalent approved smoke tenant).
- [ ] **Route signature matrix** exercised — call-event + ACK scenarios in §4 consistent with deployed env flags.
- [ ] **No unexplained blocked-metadata drift** — §3.3–3.4 counts zero **or** an explicit repair plan is approved and tracked.

If any item fails: **no-go** until remediated or risk explicitly accepted with owner sign-off.
