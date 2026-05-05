# OPS Architecture Red-Team Audit

Date: 2026-05-04  
Scope: repo-wide architecture audit for idempotency, duplicate prevention, queue determinism, OCI export correctness, race conditions, lifecycle state machines, silent failure paths.  
Method: read-only code/migration/test audit (no code changes in this pass).

---

## 1) Executive Verdict

- Overall system risk: **HIGH**
- Short rationale:
  - Strong deterministic foundations exist (DB unique contracts, advisory locks, outbox claim/finalize RPCs, session reuse hardening).
  - But there are still **high-severity security/architecture gaps** that can break trust boundaries or produce silent operational mismatch.

### Top 10 Risks

1. **Over-broad GRANTs in OCI transition migration** can expose privileged mutation surfaces to `anon/authenticated` (`supabase/migrations/20261223020200_oci_queue_transitions_ledger_and_claim_rpcs.sql`) — **P0**.
2. **Hardcoded API key in Apps Script** file (`scripts/google-ads-oci/GoogleAdsScriptMuratcanAku.js`) — credential exposure risk — **P0**.
3. Stage/status/seal routes can return overall success while `oci_enqueue_ok=false` (artifact may be missing) (`app/api/intents/[id]/stage/route.ts`, `app/api/intents/[id]/status/route.ts`, `app/api/calls/[id]/seal/route.ts`) — **P1**.
4. `apply_call_action_v2` allows stage coercion behavior that can mask invalid transitions (`supabase/migrations/20260502103000_apply_call_action_v2_caller_phone_sha256.sql`) — **P1**.
5. Outbox pre-dedupe not enforced at DB level (known ADR) can inflate pending workload under bursts (`docs/architecture/OCI_OUTBOX_PRE_DEDUPE_ADR.md`) — **P1**.
6. Mixed clock discipline: ACK route uses app clock while ACK-failed uses DB clock (`app/api/oci/ack/route.ts`, `app/api/oci/ack-failed/route.ts`) — **P1/P2**.
7. Conversion-name docs drift from SSOT constants can cause operator misconfiguration (`scripts/google-ads-oci/README.md` vs `lib/domain/mizan-mantik/conversion-names.ts`) — **P1**.
8. Risk of semantic drift between `intent_stamp` authority and optional `canonical_intent_key` usage across modules — **P1**.
9. Some `ok:true` responses are non-progressing outcomes (lock held/no pending), easy to misinterpret operationally (`app/api/cron/oci/process-outbox-events/route.ts`) — **P2**.
10. Tenant-scoping discipline is mostly good but has isolated weak reads without explicit `site_id` filter in some paths (reviewed exporter path) — **P2**.

### Top 10 Quick Wins

1. Revoke broad grants from `anon/authenticated` for transition/snapshot mutation functions; grant only to `service_role`.
2. Rotate leaked API key immediately; remove inline key default from script.
3. Make stage/status/seal fail-closed when enqueue artifact was not produced (`oci_enqueue_ok=false`).
4. Enforce explicit invalid-stage exception in `apply_call_action_v2`.
5. Add migration test that forbids `GRANT ALL ... TO anon/authenticated` on privileged OCI functions.
6. Unify ACK timestamp source to DB-now helper in both ACK and ACK-failed paths.
7. Align Google conversion names in docs/scripts with SSOT constants only.
8. Add explicit progress flag (`progress_made`) to cron/worker route outputs.
9. Add test gate for credential literals in `scripts/google-ads-oci/*.js`.
10. Add explicit tenant filter assertions for all read/write paths touching `calls`, `sessions`, and OCI tables.

### Top 10 Structural Fixes

1. Single authoritative transition matrix in DB for lifecycle state machine (no silent coercion).
2. Make producer contract strict: “queued” means outbox row exists OR durable reconciliation row exists.
3. Implement outbox pre-dedupe index + deterministic conflict handling.
4. Unify producer/consumer click attribution via one shared resolver contract and test parity snapshots.
5. Centralize reconciliation reason enum and enforce one emit path.
6. Explicitly separate business event time from job runtime time across all export rows.
7. Build exporter-mode SSOT enforcement (one site, one active export path) with health checks.
8. Codify idempotency contract tests for every RPC mutation surface (grants + transition legality + dedupe).
9. Build “no silent ok” lint/test: `ok:true` must include either artifact id or explicit no-op reason classification.
10. Add cross-layer invariant CI job (DB contracts + route contracts + script contract).

---

## 2) Pipeline Map

### Intent/session/call pipeline

- Ingest enters via `app/api/call-event/v2/route.ts`.
- Session matching/reuse via `lib/api/call-event/match-session-by-fingerprint.ts`, `lib/services/session-service.ts`, and DB RPC `find_or_reuse_session_v1`.
- Canonical active intent identity enforced primarily by DB RPC `ensure_session_intent_v1` in `supabase/migrations/20260429160000_session_single_card_invariant.sql`.
- Additional guards:
  - active single-card index migration `20260429183000_active_session_single_card_guard.sql`
  - unique idempotency contracts migration `20260428143000_restore_intent_idempotency_contracts.sql`.

### Panel/outbox producer pipeline

- Panel mutation APIs:
  - `app/api/intents/[id]/stage/route.ts`
  - `app/api/intents/[id]/status/route.ts`
  - `app/api/calls/[id]/seal/route.ts`
- Mutation RPC path uses `apply_call_action_with_review_v1` / `apply_call_action_v2`.
- Producer: `lib/oci/enqueue-panel-stage-outbox.ts`.
- Merge context helper: `lib/oci/panel-call-merge-context.ts`.
- Notification helper: `lib/oci/notify-outbox.ts`.

### Outbox consumer pipeline

- Core consumer: `lib/oci/outbox/process-outbox.ts` (`runProcessOutbox`).
- Wrapped by worker/cron routes:
  - `app/api/workers/oci/process-outbox/route.ts`
  - `app/api/cron/oci/process-outbox-events/route.ts`
- Claim/finalize via DB RPCs in `supabase/migrations/20261113000000_outbox_events_table_claim_finalize.sql`.

### marketing_signals pipeline

- Upper-funnel exports (Contacted/Offered/Junk) materialized via consumer branch and builder modules:
  - `app/api/oci/google-ads-export/export-build-signals.ts`
  - signal routing in outbox consumer.
- Contract target names from SSOT:
  - `lib/domain/mizan-mantik/conversion-names.ts`.

### offline_conversion_queue pipeline

- Won/sealed value-lane path:
  - queue producers in outbox consumer and seal flow
  - export builder `app/api/oci/google-ads-export/export-build-queue.ts`.
- Queue transition/snapshot RPC suite migration:
  - `supabase/migrations/20261223020200_oci_queue_transitions_ledger_and_claim_rpcs.sql`.

### Google export / ACK pipeline

- Export entry route: `app/api/oci/google-ads-export/route.ts`.
- Script auth/mode split: `app/api/oci/google-ads-export/export-auth.ts`.
- Apps Script clients:
  - `scripts/google-ads-oci/GoogleAdsScript.js`
  - `scripts/google-ads-oci/GoogleAdsScriptTecrubeliBakici.js`
  - `scripts/google-ads-oci/GoogleAdsScriptMuratcanAku.js`.
- ACK endpoints:
  - `app/api/oci/ack/route.ts`
  - `app/api/oci/ack-failed/route.ts`.

### Reconciliation/observability

- Reconciliation reasons helper:
  - `lib/oci/reconciliation-reasons.ts`.
- Durable reconciliation tables/policies:
  - `supabase/migrations/20261116000000_oci_reconciliation_rls_and_outbox_claim_audit.sql`.
- Metrics and admin:
  - `lib/admin/metrics.ts`
  - `app/api/admin/metrics/route.ts`
  - queue stats/export coverage endpoints.

---

## 3) Invariant Matrix

| Invariant | Current Evidence | Pass/Fail/Unknown | File References | Severity | Fix |
|---|---|---|---|---|---|
| One canonical active intent card per session | DB `ensure_session_intent_v1` + unique guards + active-card index | Pass | `supabase/migrations/20260429160000_session_single_card_invariant.sql`, `20260429183000_active_session_single_card_guard.sql` | P0 guarded | Keep, add concurrency integration tests |
| `intent_stamp=session:{sid}` as authority | Canonicalization in DB RPC for active click cards | Pass | `20260429160000_session_single_card_invariant.sql` | P0 guarded | Add contract test against drift |
| Strong states never downgraded by late ingest | Ingest path guards exist in ensure RPC; stage RPC matrix less strict | Partial Fail | `20260429160000...`, `20260502103000_apply_call_action_v2...` | P1 | Enforce transition matrix in `apply_call_action_v2` |
| merged child rows never produce artifacts | Merge context + reconciliation skip behavior | Pass | `lib/oci/panel-call-merge-context.ts`, `lib/oci/enqueue-panel-stage-outbox.ts` | P1 guarded | Add end-to-end merged-child artifact absence test |
| Producer/consumer click attribution parity | Producer delegates to resolver aligned with consumer primary source logic | Pass | `lib/oci/oci-click-attribution.ts`, `lib/conversation/primary-source.ts`, `lib/oci/outbox/process-outbox.ts` | P1 guarded | Keep parity contract test |
| Producer “queued” semantics are durable | Routes can return success even when enqueue path says not-ok | Fail | `app/api/intents/[id]/stage/route.ts`, `status/route.ts`, `calls/[id]/seal/route.ts` | P1 | Fail-closed or explicit partial failure |
| Outbox consumer is single deterministic core | Shared `runProcessOutbox` path, claim/finalize RPC | Pass | `lib/oci/outbox/process-outbox.ts`, `20261113000000_outbox_events_table_claim_finalize.sql` | P1 guarded | Keep |
| Multiple outbox rows converge deterministically | Consumer dedupe exists; pre-dedupe at insert not fully enforced | Partial Fail | `docs/architecture/OCI_OUTBOX_PRE_DEDUPE_ADR.md` + producer/consumer code | P1 | Add DB pre-dedupe index + conflict path |
| marketing_signals only for contacted/offered/junk | Branching exists; conversion SSOT mostly aligned | Partial Pass | outbox consumer + `conversion-names.ts` | P1 | Add tests forbidding wrong lane inserts |
| offline_conversion_queue only for won | Won path generally separated | Pass/Partial | consumer + queue builder files | P1 | Add contract test to block non-won queue inserts |
| BLOCKED_PRECEDING_SIGNALS behavior | Architecture/test hints exist; needs stronger assertions | Unknown/Partial | OCI tests + queue logic | P1 | Add integration test for claim exclusion + promotion rules |
| Conversion names exact match across SSOT + scripts | SSOT file clean, docs/scripts drift found | Fail | `lib/domain/mizan-mantik/conversion-names.ts`, `scripts/google-ads-oci/README.md` | P1 | Make docs/scripts generate from SSOT |
| Conversion time uses business event time, not NOW | Builders mostly use occurred_at resolvers; ACK path clock inconsistency | Partial Fail | `app/api/oci/google-ads-export/export-build-*.ts`, `app/api/oci/ack/route.ts` | P1/P2 | Use DB-now consistently for transition stamps |
| RLS and grants least privilege | Hardened on some tables, but broad grants in 202612230202 migration | Fail | `20261116000000...`, `20261113000000...`, `20261223020200...` | P0 | Revoke/grant-tightening migration |
| Non-export paths produce durable reconciliation | Producer has reconciliation reasons; some route-level success semantics still ambiguous | Partial Fail | `lib/oci/enqueue-panel-stage-outbox.ts`, route files | P1 | Enforce strict response contract + reconciliation event requirement |
| ACK idempotency / duplicate protection | Receipt state machine and tests present | Pass | `app/api/oci/ack/route.ts`, `ack-failed/route.ts`, `tests/unit/ack-receipt-state-machine.test.ts` | P1 guarded | Keep, unify clock source |

---

## 4) Duplicate Intent Analysis

### Session splitting

- Evidence of protection:
  - `find_or_reuse_session_v1` includes advisory locks and burst-window reuse logic (`supabase/migrations/20261225000000_intent_coalesce_window_tighten_v1.sql` and predecessor).
  - Session reuse policy mirrored in app helper `lib/intents/session-reuse-v1.ts`.
- Residual risk:
  - Window tuning changes (120s → 45s / 30s → 5s) can under-merge or over-merge if business behavior drifts.
- Severity: **P1**
- Fix:
  - Add replayed real-traffic simulation tests for near-threshold click/action/target bursts.

### `intent_stamp` authority

- Evidence:
  - Canonical active intent stamp is DB-enforced in `ensure_session_intent_v1`.
- Residual risk:
  - Confusion with optional/minute-bucket canonical keys can reintroduce parallel identity logic.
- Severity: **P1**
- Fix:
  - Explicit architecture rule: session stamp is write authority; other keys are diagnostic only.

### `ensure_session_intent_v1`

- Strength:
  - Advisory lock + `ON CONFLICT (site_id,intent_stamp)` upsert + lifecycle-safe merge behavior.
- Risk:
  - Any future non-RPC insert path bypassing this function could break invariants.
- Severity: **P1**
- Fix:
  - Add static grep test to fail CI on direct active-card insert patterns outside canonical helpers.

### `SessionService` and matched_session_id

- Strength:
  - Uses reuse RPC; avoids overwriting already-attributed session click identifiers.
- Risk:
  - UUID generation implementation quality and possible identity fallback ambiguity.
- Severity: **P2**
- Fix:
  - Replace random UUID helper with `crypto.randomUUID`; keep DB collision-safe path.

### `merged_into_call_id` handling

- Strength:
  - Merge context overlay used by producer; merged child path reconciles and avoids outbox emission.
- Risk:
  - Needs stronger end-to-end test to ensure no future bypass.
- Severity: **P1**
- Fix:
  - Add integration test proving merged child never creates outbox/signals/queue.

### Frontend dedupe vs DB contracts

- Evidence:
  - Core dedupe is DB-first (unique indexes, RPC contracts).
- Risk:
  - UI-level dedupe may hide backend duplicate writes if backend guard regresses.
- Severity: **P2**
- Fix:
  - Add backend-only integration tests; do not accept UI dedupe as correctness proof.

---

## 5) Idempotency Analysis

### DB constraints / ON CONFLICT

- Strong:
  - Intent idempotency contracts restored in `20260428143000_restore_intent_idempotency_contracts.sql`.
  - Single active session card guard index in `20260429183000_active_session_single_card_guard.sql`.
- Gap:
  - Outbox producer pre-dedupe not fully enforced at DB insert.

### Queue/signal dedupe and convergence

- Queue transition model improved with ledger/snapshot migration set (and equivalent checks applied remotely).
- Consumer claims atomically and finalizes deterministically.
- Risk:
  - Pending outbox burst amplification still possible before convergence.

### ACK idempotency / retries

- Good:
  - Ack receipt registration/complete model + state machine test.
- Gap:
  - ACK route timestamp source inconsistency.

### Summary

- Idempotency posture: **good core, incomplete edges**.
- Severity: **P1**
- Fix priority:
  1. outbox pre-dedupe
  2. lifecycle transition hard-fencing
  3. strict producer response semantics.

---

## 6) OCI Export Analysis

### Contacted / Offered / Junk path

- Intended lane: `marketing_signals`.
- SSOT conversion names exist in `lib/domain/mizan-mantik/conversion-names.ts`.
- Risks:
  - Docs/scripts drift can cause wrong Google action mapping.
  - Need explicit tests for junk fixed value contract (`value_cents=10`, fixed source).

### Won path

- Intended lane: `offline_conversion_queue`.
- Separation mostly present.
- Need stronger tests to ensure non-won statuses never hit queue.

### Value and conversion time handling

- Builder modules include occurred-at resolution patterns.
- Risk:
  - Some runtime paths still rely on runtime timestamps for transitions and may blur business event vs processing time.

### BLOCKED_PRECEDING_SIGNALS

- Logic/intent exists; contract needs stronger proof tests for claim exclusion and controlled promotion.

### Apps Script alignment + dual exporter risk

- Export mode split (`oci_sync_method`) exists in `app/api/oci/google-ads-export/export-auth.ts` and API exporter path.
- Residual risk:
  - Old scripts with bad config can still create noisy failures; leaked key worsens this.

### Verdict

- OCI export correctness: **Medium-to-High risk until P0/P1 fixes**.

---

## 7) Silent Failure Analysis

Below are suspicious silent or ambiguous success patterns requiring tightening:

1. **Stage route success despite enqueue failure**
   - File: `app/api/intents/[id]/stage/route.ts`
   - Condition: mutation succeeded; enqueue result may be `ok:false`
   - Current output: overall success payload with diagnostics
   - Required: fail-closed or explicit partial failure HTTP status + durable reconciliation required

2. **Status route success despite enqueue failure**
   - File: `app/api/intents/[id]/status/route.ts`
   - Same pattern and fix as above

3. **Seal route success despite enqueue failure**
   - File: `app/api/calls/[id]/seal/route.ts`
   - Same pattern and fix as above

4. **Cron outbox endpoint returns `ok:true` for lock-held/no-work**
   - File: `app/api/cron/oci/process-outbox-events/route.ts`
   - Condition: lock held or no pending events
   - Current output: `ok:true` with skip/no-op metadata
   - Required: add `progress_made=false`, monitoring must not treat as successful work

5. **Stage coercion in DB RPC (silent semantic fallback)**
   - File: `supabase/migrations/20260502103000_apply_call_action_v2_caller_phone_sha256.sql`
   - Condition: unsupported stage
   - Current behavior: coerces to intent (observed)
   - Required: throw explicit invalid transition/invalid stage error

6. **Credential default in script encourages insecure silent usage**
   - File: `scripts/google-ads-oci/GoogleAdsScriptMuratcanAku.js`
   - Current behavior: inline API key fallback
   - Required: remove fallback, hard-fail when property missing

---

## 8) RLS and Tenant Isolation Analysis

### Strong areas

- `outbox_events` claim/finalize service-role patterns are hardened in `20261113000000_outbox_events_table_claim_finalize.sql`.
- `oci_reconciliation_events` got dedicated RLS/grants hardening in `20261116000000_oci_reconciliation_rls_and_outbox_claim_audit.sql`.
- `offline_conversion_queue` / `marketing_signals` have RLS contract migration support (`20260502194500_public_oci_and_ledger_tables_rls.sql`).

### Critical concern

- `20261223020200_oci_queue_transitions_ledger_and_claim_rpcs.sql` grants broad table/function access to `anon/authenticated`.
- Even with function-internal role checks, this violates least privilege and broadens attack surface.

### Admin/service-role usage

- Most privileged write paths appear intentional via server/admin clients and security-definer RPCs.
- Need explicit CI checks to prevent accidental public-client mutation paths.

### Verdict

- Tenant isolation posture: **Mixed**.
- Risk: **P0** until grants tightened.

---

## 9) Test Gap Map

| Proposed Test File | Test Name | Fixture Setup | Expected Assertion |
|---|---|---|---|
| `tests/unit/oci-rpc-grants-hardening.test.ts` | `transition RPCs are service_role-only` | Parse migration SQL / introspection contract | No `GRANT ALL` to `anon/authenticated` on privileged functions/tables |
| `tests/integration/panel-stage-failclosed.test.ts` | `stage returns partial failure when enqueue artifact missing` | Mock `enqueuePanelStageOciOutbox` to `ok:false` | Route is non-2xx or explicit partial-failure contract |
| `tests/integration/panel-status-failclosed.test.ts` | `status respects producer failure contract` | same | same |
| `tests/integration/panel-seal-failclosed.test.ts` | `seal respects producer failure contract` | same | same |
| `tests/unit/apply-call-action-transition-matrix.test.ts` | `invalid stage rejected, no silent coercion` | SQL contract parse or DB test | Invalid stage throws |
| `tests/integration/merged-child-no-artifacts.test.ts` | `merged child cannot create outbox/signals/queue` | Create winner/loser merge scenario | No new artifacts for child |
| `tests/unit/conversion-name-ssot-scripts-contract.test.ts` | `script/doc names match conversion SSOT` | Load SSOT names + script/doc config strings | Exact set match of 4 required names |
| `tests/unit/ack-time-source-contract.test.ts` | `ack and ack-failed use DB authoritative time` | inspect handlers | No app-clock time in persistence payloads |
| `tests/integration/outbox-prededupe-burst.test.ts` | `burst stage actions converge with bounded pending rows` | Parallel stage calls same call/stage | Pending row count bounded and deterministic |
| `tests/unit/no-secret-literals-google-scripts.test.ts` | `google scripts contain no inline API keys` | scan script files | fail on key-like literals / forbidden vars |

---

## 10) Fix Plan

### P0 — Production Safety / Data Correctness

1. **Grant hardening migration**
   - Revoke broad grants for transition/snapshot tables/functions from `anon/authenticated`.
   - Grant only required access to `service_role`.
2. **Secret incident response**
   - Rotate leaked script API key.
   - Remove inline key fallback from scripts.
3. **Deploy guard**
   - Add CI check blocking privileged `GRANT ALL` regressions.

### P1 — Deterministic Hardening

1. Fail-closed producer API semantics when enqueue contract fails.
2. Enforce explicit lifecycle transition matrix in `apply_call_action_v2`.
3. Implement outbox pre-dedupe (index + deterministic conflict behavior).
4. Unify timestamp semantics for ACK path to DB-now.
5. Strengthen BLOCKED_PRECEDING_SIGNALS contract tests.

### P2 — Observability and UX

1. Add `progress_made` semantics to cron/worker status outputs.
2. Normalize reconciliation reason taxonomy and dashboards.
3. Add explicit metrics for every non-export terminal reason.

### P3 — Refactor / Cleanup

1. Eliminate identity terminology ambiguity (`intent_stamp` vs optional keys).
2. Replace weak UUID generation implementation in session service.
3. Remove stale/legacy docs that conflict with SSOT.

---

## 11) Suggested Cursor Task Chain (Small Commits)

1. **Commit title:** `fix(db-security): restrict OCI transition grants to service_role`
   - Files: new migration under `supabase/migrations/`, tests in `tests/unit/`
   - Tests: grant contract test + migration lint gate
   - Risk: **Low** (security hardening)

2. **Commit title:** `fix(security): remove inline OCI script key and require properties`
   - Files: `scripts/google-ads-oci/GoogleAdsScriptMuratcanAku.js`, script README
   - Tests: secret literal scanner test
   - Risk: **Medium** (ops rollout coordination)

3. **Commit title:** `fix(api): fail closed on OCI enqueue artifact failure`
   - Files: stage/status/seal routes + route tests
   - Tests: 3 integration tests for partial failure semantics
   - Risk: **Medium** (API contract change)

4. **Commit title:** `fix(fsm): reject invalid stage transitions in apply_call_action_v2`
   - Files: new DB migration + DB contract tests
   - Tests: transition matrix + invalid stage rejection
   - Risk: **Medium/High** (behavioral strictness)

5. **Commit title:** `feat(outbox): enforce pending pre-dedupe for panel stage`
   - Files: migration + producer conflict handling + architecture tests
   - Tests: burst convergence test + invariants
   - Risk: **Medium**

6. **Commit title:** `fix(time): use db-authoritative timestamps in ACK path`
   - Files: `app/api/oci/ack/route.ts` + tests
   - Tests: ack time-source parity
   - Risk: **Low**

7. **Commit title:** `chore(contract): align conversion names docs/scripts with SSOT`
   - Files: script README/docs/tests
   - Tests: conversion name contract test
   - Risk: **Low**

---

## Additional Notes / Uncertainty

- Some invariants are marked **Unknown/Partial** where full runtime-only behavior depends on production data shape or scripts not fully covered by automated tests.
- No uncertainty was hidden; where proof is incomplete, recommended tests are included above.

---

## Approval Gate

This is the first-pass audit report only (no code changes made in this pass).  
Please approve the remediation phase and choose execution order:

- **Option A (safety first):** P0 only
- **Option B:** P0 + P1
- **Option C:** full P0→P3 chain

---

## 12) Deep Evidence Appendix (Pattern-Level Sweep)

This section is a second-pass deep scan over broad patterns the first pass flagged.

### 12.1 Silent `ok:true` Classification (High-Noise/High-Risk Surfaces)

Pattern scan found many `ok:true` responses. Most are benign acknowledgements, but these classes need strict interpretation contracts:

- **No-op but ok:true (lock/no work)**
  - `app/api/cron/oci/process-outbox-events/route.ts`
  - `app/api/cron/vacuum/route.ts`
  - `app/api/cron/providers/recover-processing/route.ts`
  - `app/api/cron/oci/promote-blocked-queue/route.ts`
  - `app/api/cron/sweep-unsent-conversions/route.ts`
- **Business mutation + potential partial side-effect**
  - `app/api/intents/[id]/stage/route.ts`
  - `app/api/intents/[id]/status/route.ts`
  - `app/api/calls/[id]/seal/route.ts`
- **Worker ack-and-skip semantics (intentional but risky if misread)**
  - `lib/ingest/execute-ingest-command.ts` (multiple gate skip returns)
  - `lib/oci/process-single-oci-export.ts` (`ALREADY_*`, `SKIPPED_BY_SYNC_METHOD`)

Deep recommendation:
- Introduce response schema fields:
  - `progress_made: boolean`
  - `artifact_written: boolean`
  - `reconciled: boolean`
  - `classification: 'processed'|'skipped_lock'|'skipped_gate'|'partial_failure'`
- Monitoring/alerts must key on these, not raw `ok`.

### 12.2 Catch Blocks / Error Swallowing Sweep

Wide `catch` usage is expected in API/worker code; red-team focus is “swallow and continue silently.”

Notable suspicious swallow patterns:
- `scripts/db/oci-2240-rontgen-saldiri-ayikla.mjs` includes `catch (_) {}`
- `scripts/verify-dashboard-i18n-atomic.mjs` includes empty-ish catch body
- `public/ux-core.js` contains generic `catch (_)`, non-critical but hides diagnostics

Most critical runtime paths do log or reconcile (producer/consumer/ack routes), but script/tooling swallows should be cleaned to avoid false confidence in ops tooling outputs.

### 12.3 Direct Insert Surface Sweep (Bypass Risk)

Search for direct inserts found:
- `marketing_signals` direct inserts in utility/test scripts:
  - `scripts/final_db_verify.js`
  - `scripts/test_minimal_insert.ts`
  - `scripts/verify_db_integration.ts`
- `offline_conversion_queue` direct SQL insert appears in schema functions (expected) and tests.

Risk:
- Low for production if these are non-prod scripts, but they can normalize bypass behavior culturally.

Recommendation:
- Add “production write path policy” test/docs:
  - allowed writers list
  - forbid new app-route direct inserts bypassing canonical helpers.

### 12.4 NOW()/Time Semantics Deep Sweep

Findings:
- Good safety: `20260508120000_panel_oci_schema_safety_net.sql` removes default `google_conversion_time` behavior drift.
- Risky fallback remains:
  - `lib/oci/pulse-recovery-worker.ts` may fallback to `new Date().toISOString()` when call time missing.
- ACK mismatch remains:
  - `app/api/oci/ack/route.ts` app-clock usage (first pass finding)
  - `ack-failed` path uses DB-now helper.

Recommendation:
- Policy: only metadata timestamps may use app/now; business conversion timestamps must use event-derived or DB-authoritative inputs.
- Add contract test that fails on export pipeline runtime-now fallbacks for conversion time.

### 12.5 Grants/RLS Drift Deep Sweep

Confirmed high-risk drift:
- `supabase/migrations/20261223020200_oci_queue_transitions_ledger_and_claim_rpcs.sql`
  - `GRANT ALL ON TABLE/FUNCTION ... TO anon, authenticated, service_role`

Confirmed stronger baseline elsewhere:
- `20261113000000_outbox_events_table_claim_finalize.sql` (service-role model)
- `20261116000000_oci_reconciliation_rls_and_outbox_claim_audit.sql` (RLS + scoped policy)
- `20260502194500_public_oci_and_ledger_tables_rls.sql` (`_can_access_site` read policies + service_role writes)

Deep recommendation:
- Add migration linter in CI:
  - block `GRANT ALL ... TO anon/authenticated` unless explicit allowlist
  - require rationale comment + policy reference for any broadened grant.

### 12.6 `merged_into_call_id` Enforcement Sweep

Deep grep confirms strong repeated checks in:
- session reuse RPCs
- burst coalescing triggers
- cleanup/dedupe migrations
- producer merge-context helper

This is a strong positive signal: merged child exclusion is encoded in multiple layers.  
Residual risk remains only if future writers skip canonical DB/producer helpers.

### 12.7 Additional Unknowns to Prove

These remain unknown without runtime replay or broader data snapshots:

- Whether any legacy cron/script path still writes export artifacts from merged rows under rare stale-read races.
- Whether all site-specific scripts in operations use exact SSOT conversion names in deployed Script Properties.
- Whether any external dashboards still interpret `ok:true` as “work completed” rather than “request acknowledged.”

Proof plan:
- 24h replay on staging with synthetic duplicates and merged child scenarios.
- Artifact-level diff checks:
  - outbox rows
  - marketing_signals rows
  - offline_conversion_queue rows
  - reconciliation rows.

---

## 13) Deep-Deep Forensic Delta (Third Pass)

This pass verifies explicit contradictory evidence and edge invariants with targeted grep across migrations/routes/scripts.

### 13.1 Lifecycle State Machine: Stage Coercion Is Confirmed

Evidence (multiple migration generations of `apply_call_action_v2`):
- `supabase/migrations/20260502103000_apply_call_action_v2_caller_phone_sha256.sql`
  - `v_target_status := lower(coalesce(nullif(trim(p_stage), ''), 'intent'));`
  - then fallback branch sets `v_target_status := 'intent'`.
- Same pattern appears in:
  - `20260501193000_harden_apply_call_action_v2_canonical_signature.sql`
  - `20260501132805_hotfix_relax_apply_call_action_v2_role_gate.sql`
  - `20260501132741_hotfix_restore_apply_call_action_v2.sql`
  - `20260501144340_remote_schema.sql`

Assessment:
- The “silent coercion to intent” is not hypothetical; it is repeated and versioned.
- Severity: **P1** (state-machine correctness and hidden caller bugs).

Required fix:
- New migration to throw `invalid_stage`/`illegal_transition` for unsupported stage values.
- Add regression tests to ensure no fallback-to-intent behavior remains.

### 13.2 Grant Exposure: Still the Strongest P0

Evidence:
- `supabase/migrations/20261223020200_oci_queue_transitions_ledger_and_claim_rpcs.sql` lines in grant block:
  - `GRANT ALL ON TABLE public.oci_payload_validation_events TO anon, authenticated, service_role;`
  - `GRANT ALL ON TABLE public.oci_queue_transitions TO anon, authenticated, service_role;`
  - `GRANT ALL ON FUNCTION ... append_* / apply_snapshot_batch / assert_* / claim_* TO anon, authenticated, service_role;`

Even though functions contain service-role guards, this remains a boundary smell:
- public role exposure increases callable surface and future regression risk.
- violates least-privilege consistency with hardened outbox/reconciliation migrations.

Severity: **P0**

Required fix:
- Immediate revoke/tighten migration + CI guard.

### 13.3 Conversion Name Drift Is Broader Than First Pass

Confirmed canonical runtime names:
- `OpsMantik_Contacted`
- `OpsMantik_Offered`
- `OpsMantik_Won`
- `OpsMantik_Junk_Exclusion`

Confirmed drift still present in repo:
- `scripts/google-ads-oci/README.md` references legacy `OpsMantik_V1..V5`.
- `docs/operations/OCI_OPERATIONS_SNAPSHOT.md` still maps V1..V5 lanes.
- `docs/runbooks/OCI_CONVERSION_INTENT_FLOW_DIAGRAM.md` contains V3/V4/V5 naming.
- `scripts/fix_oci_config.mjs` and several DB helper scripts still encode V2/V3/V4/V5 literals.

Interpretation:
- Runtime SSOT can be correct while operational docs/scripts are stale and dangerous.
- This is a real operator-error vector during incident/manual operations.

Severity: **P1**

Required fix:
- “single-source generated docs” policy for conversion names.
- test that fails if any non-allowlisted file contains `OpsMantik_V[1-5]_`.

### 13.4 BLOCKED_PRECEDING_SIGNALS: Contract Looks Correct, Needs Runtime Proof

Strong evidence:
- Claim path in queue-transition functions only allows statuses `('QUEUED','RETRY')`.
- Runbooks/tests/docs emphasize `BLOCKED_PRECEDING_SIGNALS` exclusion and promotion path.
- Promote route exists (`app/api/cron/oci/promote-blocked-queue/route.ts`).

Remaining unknown:
- Need replay proof that no alternate claim path or script bypass promotes/claims blocked rows incorrectly under race.

Severity: **P1 (unknown-until-proven)**

Required fix:
- Integration chaos test:
  - pending precursor signals + won row blocked
  - verify claim APIs skip blocked row
  - verify only promotion route/worker transitions blocked -> queued.

### 13.5 `ok:true` Semantics: Distinguish “Ack/Skip” vs “Business Success”

Third-pass classification confirms a design pattern:
- Some `ok:true` are protocol acknowledgements (QStash/gate skip).
- Some are operational no-op (`lock_held`, `no_pending_events`).
- Some are business mutation responses where enqueue may still fail.

Without explicit classification, dashboards/clients can over-trust `ok:true`.

Severity: **P1/P2** depending endpoint.

Required fix:
- Mandatory response envelope fields:
  - `progress_made`
  - `artifact_written`
  - `classification`
  - `reconciliation_recorded`

### 13.6 Security-Secrets Posture in Apps Scripts

Current scripts show inline key fallback pattern (`OPSMANTIK_INLINE_API_KEY`), even if empty by default.
- This normalizes insecure usage and historically enabled secret leakage risk.

Severity: **P0/P1**

Required fix:
- Remove inline key support entirely.
- Force Script Properties only.
- Add repo secret-literal scanner for these paths.

### 13.7 Updated Priority Delta

After third pass, the top order remains:
1. **P0** grants hardening migration
2. **P0** script secret policy hardening/rotation
3. **P1** strict stage validation (no silent coercion)
4. **P1** response semantics split (`ok` vs business progress)
5. **P1** conversion-name drift cleanup across docs/scripts
6. **P1** blocked-queue claim exclusion integration proof

---

## 14) Red-Team Attack Trees (Fourth Pass)

This section turns “deep audit” into explicit adversary narratives. Each row lists: **precondition → exploit path → blast radius → detection → fix**.

### 14.1 “Business mutation succeeded, OCI did not” (Silent Partial Success)

- **Precondition:** Panel operator applies a stage change that persists via `apply_call_action_v2`.
- **Exploit path:** `enqueuePanelStageOciOutbox` returns `ok:false` (no outbox insert, reconciliation may or may not persist depending on branch), but the route still returns HTTP **200** with `success:true`.
- **Blast radius:** Operator believes OCI pipeline advanced; Google side never receives the expected signal/queue artifact until manual investigation.
- **Detection:** `panel_stage_oci_producer_incomplete_total` (incremented when `!oci.ok` in stage route); client must read `oci_enqueue_ok`.
- **Evidence (stage route):**

```252:272:app/api/intents/[id]/stage/route.ts
    const oci = await enqueuePanelStageOciOutbox(callObj as PanelReturnedCall, { requestId });
    if (!oci.ok) {
      incrementRefactorMetric('panel_stage_oci_producer_incomplete_total');
    }

    void notifyOutboxPending({ callId, siteId, source: 'panel_stage_v2' });
    void triggerOutboxNowBestEffort({ callId, siteId, source: 'panel_stage_v2' });

    return NextResponse.json({
      success: true,
      call: callObj,
      persisted_status: persistedStatus,
      queued: oci.outboxInserted,
      oci_outbox_inserted: oci.outboxInserted,
      oci_reconciliation_persisted:
        oci.reconciliationPersisted === undefined ? null : oci.reconciliationPersisted,
      oci_reconciliation_reason: oci.oci_reconciliation_reason,
      oci_enqueue_ok: oci.ok,
      code: 'OK',
      request_id: requestId,
    });
```

- **Evidence (seal probe path, same pattern):**

```164:182:app/api/calls/[id]/seal/route.ts
      const ociProbe = await enqueuePanelStageOciOutbox(callObj, { requestId });
      if (!ociProbe.ok) incrementRefactorMetric('panel_stage_oci_producer_incomplete_total');

      void notifyOutboxPending({ callId, siteId: call.site_id, source: 'seal_probe_v2' });
      void triggerOutboxNowBestEffort({ callId, siteId: call.site_id, source: 'seal_probe_v2' });

      return NextResponse.json({
        success: true,
        approval_required: false,
        call: callObj,
        queued: ociProbe.outboxInserted,
        oci_outbox_inserted: ociProbe.outboxInserted,
        oci_reconciliation_persisted:
          ociProbe.reconciliationPersisted === undefined ? null : ociProbe.reconciliationPersisted,
        oci_reconciliation_reason: ociProbe.oci_reconciliation_reason,
        oci_enqueue_ok: ociProbe.ok,
        request_id: requestId,
      });
```

- **Fix:** fail-closed HTTP semantics **or** `success:false` with explicit `PARTIAL_SUCCESS` code; never pair `success:true` with `oci_enqueue_ok:false`.

### 14.2 “Fire-and-forget side effects after producer failure”

- **Precondition:** Same as 14.1 (`!oci.ok`).
- **Exploit path:** `notifyOutboxPending` and `triggerOutboxNowBestEffort` are invoked with `void` (non-awaited) even when enqueue failed, causing **noise / false triggers / wasted QStash** without durable artifact.
- **Blast radius:** Operational cost + misleading “something happened” signals; harder incident triage.
- **Detection:** correlate `panel_stage_oci_producer_incomplete_total` spikes with QStash delivery volume.
- **Fix:** gate notify/trigger on `oci.ok === true` **or** enqueue a durable “repair” job with explicit reason.

### 14.3 PostgREST Callable Surface Expansion (Broad GRANT)

- **Precondition:** `anon`/`authenticated` roles can `EXECUTE` privileged transition batch functions due to migration grants.
- **Exploit path:** Any vulnerability that allows calling PostgREST RPC as authenticated user (XSS token theft, leaked user JWT, compromised browser session) expands into **queue ledger manipulation attempts** even if `SECURITY DEFINER` checks block most calls.
- **Blast radius:** Attack surface + unexpected dependency on “function body must always reject non-service_role”.
- **Detection:** Postgres logs + anomaly detection on failed RPC calls; security advisor.
- **Fix:** revoke `anon/authenticated` execute on these functions; **service_role only**.

### 14.4 Stage Coercion Enables “Wrong lifecycle write” Without Obvious API Error

- **Precondition:** Caller passes unexpected `p_stage` string.
- **Exploit path:** `apply_call_action_v2` normalizes unknown stage to `intent` (silent semantic downgrade/reset risk depending on caller expectations).
- **Blast radius:** Wrong funnel state, wrong downstream OCI stage classification, misleading dashboards.
- **Detection:** audit logs + unexpected status distribution shifts.
- **Fix:** strict transition matrix; return explicit SQL error codes.

### 14.5 QStash Double Delivery → Duplicate Outbox Claims (Should Converge)

- **Precondition:** QStash retries or duplicate deliveries to worker endpoints.
- **Exploit path:** duplicate processing attempts; must converge via claim RPC idempotency and row-level ownership.
- **Blast radius:** usually low if claim is correct; spikes load and can amplify partial failures.
- **Detection:** worker metrics for claim mismatch / duplicate deliveries.
- **Fix:** keep strict claim semantics; add `progress_made` to worker responses; monitor duplicate webhook rate.

### 14.6 Conversion Name Drift Enables “Wrong Google Action” in Manual Ops

- **Precondition:** operator follows stale README / snapshot docs using `OpsMantik_V*` names.
- **Exploit path:** Google Ads receives uploads mapped to non-existent or legacy actions; silent drops or mismatched optimization.
- **Blast radius:** revenue attribution drift.
- **Detection:** Google Ads diagnostics + export coverage endpoints.
- **Fix:** docs generated from `lib/domain/mizan-mantik/conversion-names.ts` SSOT; delete legacy strings from operator paths.

---

## 15) Trust Boundary Map (Control Plane vs Data Plane)

| Plane | Responsibility | Primary Mechanism | Failure Mode |
|------:|----------------|-------------------|--------------|
| Control | Panel/auth decisions | Next routes + RBAC + `validateSiteAccess` | “success” UI/API mismatch |
| Data | Canonical rows + invariants | SQL RPC + constraints + RLS | drift between RPC versions |
| Export | Artifact creation | outbox + worker + script/API | silent skip / wrong time/value |
| Evidence | Explain non-export | `oci_reconciliation_events` + metrics | missing row |

**Deep conclusion:** OpsMantik is strongest in the **data plane** (SQL contracts). The largest residual risk is **control-plane response semantics** (HTTP/`success` flags) diverging from durable artifacts.

---

## 16) Residual Unknown Register (Honest “We Still Don’t Know”)

| Unknown | Why it matters | How to prove/disprove quickly |
|--------:|----------------|------------------------------|
| Production `apply_call_action_v2` body vs repo migration chain | drift risk if remote hotfixes not mirrored | `list_migrations` + `pg_get_functiondef` diff against `schema_utf8.sql` slice |
| Whether any client ignores `oci_enqueue_ok` | determines real-world silent failure rate | log sampling + client contract tests |
| Whether promotion cron is enabled in all prod projects | blocked won backlog risk | Vercel cron inventory + `export-coverage` time series |
| Whether legacy Google Ads actions still exist in any tenant | mis-upload / mismatch | per-site audit script against SSOT list |

---

## 17) Approval Gate (unchanged)

Remediation still requires explicit approval (no implementation started in audit-only phases).

---

## 18) Producer Core Forensics (`enqueuePanelStageOciOutbox`)

This pass focuses on the **actual** durable-contract implementation, not route wrappers.

### 18.1 The “no silent success” invariant exists in code — but routes can still lie

The producer defines an explicit boolean gate:

```107:110:lib/oci/enqueue-panel-stage-outbox.ts
/** INV: no silent success — at least one durable artifact. */
export function panelStageOciProducerOk(r: Pick<PanelStageOciEnqueueResult, 'outboxInserted' | 'reconciliationPersisted'>): boolean {
  return r.outboxInserted || r.reconciliationPersisted === true;
}
```

**Interpretation:**
- If outbox insert fails **and** reconciliation persistence fails, `ok` should be `false` (no durable artifact).
- If outbox insert fails **but** reconciliation persists, `ok` is `true` (durable explanation exists).

Evidence for insert-failure path:

```329:363:lib/oci/enqueue-panel-stage-outbox.ts
  if (insertError) {
    incrementRefactorMetric('panel_stage_outbox_insert_failed_total');
    logWarn('panel_stage_outbox_insert_failed', {
      call_id: effectiveCall.id,
      site_id: effectiveCall.site_id,
      stage,
      message: insertError.message,
    });
    let reconciliationPersisted = false;
    try {
      await appendOciReconciliationEvent({
        siteId: effectiveCall.site_id,
        callId: effectiveCall.id,
        stage,
        reason: OCI_RECONCILIATION_REASONS.OUTBOX_INSERT_FAILED,
        matchedSessionId: effectiveCall.matched_session_id ?? null,
        primaryClickIdPresent: true,
        payload: { insert_error: insertError.message },
      });
      reconciliationPersisted = true;
    } catch (reconciliationError) {
      logWarn('panel_stage_outbox_insert_failed_reconciliation_best_effort_failed', {
        call_id: effectiveCall.id,
        site_id: effectiveCall.site_id,
        stage,
        error: reconciliationError instanceof Error ? reconciliationError.message : String(reconciliationError),
      });
    }
    const ok = panelStageOciProducerOk({ outboxInserted: false, reconciliationPersisted });
    return {
      ok,
      outboxInserted: false,
      reconciliationPersisted,
      oci_reconciliation_reason: OCI_RECONCILIATION_REASONS.OUTBOX_INSERT_FAILED,
    };
  }
```

**Deep risk:** reconciliation append itself is best-effort at the wrapper level too:

```12:28:lib/oci/enqueue-panel-stage-outbox.ts
async function appendReconciliationBestEffort(
  params: Parameters<typeof appendOciReconciliationEvent>[0]
): Promise<{ persisted: boolean }> {
  try {
    await appendOciReconciliationEvent(params);
    return { persisted: true };
  } catch (error) {
    incrementRefactorMetric('panel_stage_reconciliation_persist_failed_total');
    logWarn('panel_stage_reconciliation_persist_failed', {
      call_id: params.callId,
      site_id: params.siteId,
      stage: params.stage,
      reason: params.reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return { persisted: false };
  }
}
```

So the system can still end in **`ok:false`** (good) but the **HTTP layer** can still return `success:true` (bad UX/ops contract). That split is the deepest architectural tension discovered so far.

### 18.2 Outbox schema: indexes exist, but there is no “one pending row per (call,stage)” uniqueness (by design today)

From migration `20261113000000_outbox_events_table_claim_finalize.sql`, the table has helpful btree indexes (pending ordering, `(site_id, call_id)`), but **not** a partial unique index that prevents duplicate `PENDING` IntentSealed rows for the same call/stage burst.

This matches the explicit ADR posture: correctness via consumer convergence, at the cost of queue depth under bursts.

**Deep implication:** duplicate pending outbox rows are **not** automatically “impossible”; they are **converged later**. This is acceptable only if convergence proofs remain green under load.

### 18.3 Downstream dedupe anchors (positive evidence)

These unique indexes materially reduce duplicate Google artifacts even if outbox duplicates exist:

- `idx_marketing_signals_site_call_gear_seq` on `(site_id, call_id, google_conversion_name, adjustment_sequence)` (`20260502120000_ensure_oci_queue_and_signals.sql`)
- offline queue uniqueness patterns in the same migration family (site/provider/external_id active; site/session pending)

This is a strong “second line of defense.”

---

## 19) Notify/QStash/Cron Triangle (Deepest Operational Semantics)

`notifyOutboxPending` is explicitly **best-effort** and **non-authoritative**:

```1:13:lib/oci/notify-outbox.ts
 * Failures are logged and swallowed: the cron at
 * /api/cron/oci/process-outbox-events is the safety net that guarantees
 * eventual processing even if every notify publish is dropped.
```

Additional deep behaviors:
- If base URL is not absolute HTTPS, notify **silently skips** (warn only).
- QStash publish failures are swallowed (metric + warn).

**Deep red-team critique:**
- Panel routes still call `notifyOutboxPending` even when `enqueuePanelStageOciOutbox` did not insert a row (`void`, non-gated). That means you can generate **worker triggers without durable outbox rows**, increasing noise and confusing traces.

**Required fix:** gate notify/trigger on `oci.ok && oci.outboxInserted` (or emit a different trigger type for “reconcile-only” paths).

---

## 20) Invariant Dependency Graph (What Depends on What)

```text
[RLS + grants least-privilege]
        │
        ▼
[SQL RPC apply_call_action_v2] ──► [calls row truth + version]
        │                                 │
        │                                 ├─► [enqueuePanelStageOciOutbox]
        │                                 │         │
        │                                 │         ├─► outbox_events (PENDING)
        │                                 │         └─► oci_reconciliation_events (skip/fail)
        │                                 │
        │                                 └─► [notifyOutboxPending] (best-effort)
        │
        ▼
[claim_outbox_events FOR UPDATE SKIP LOCKED] ──► [process-outbox consumer]
        │
        ├─► marketing_signals (upper funnel)
        └─► offline_conversion_queue (won lane)
                │
                └─► Google upload + ACK receipts
```

**Deep conclusion:** correctness is a **chain**. The weakest links observed are:
1) HTTP/`success` semantics vs producer `ok`
2) notify triggers without outbox rows
3) grant surface regression risk
4) operator-facing conversion-name drift

---

## 21) “Ultra-Deep” Severity Re-Ranking (After Producer Forensics)

| Rank | Item | Why it moved |
|---:|------|--------------|
| 1 | HTTP `success:true` while producer `ok:false` | violates operator mental model even when logs/metrics exist |
| 2 | notify/trigger without outbox insert | creates false “pipeline active” signals |
| 3 | broad GRANT regression | expands blast radius of any future mistake |
| 4 | `apply_call_action_v2` coercion | corrupts state machine observability |
| 5 | conversion-name drift | operational misconfig risk |

---

## 22) Approval Gate (still unchanged)

Remediation still requires explicit approval.

---

## 23) Trust-Boundary Forensics (Worker / Cron / Script ACK)

This section answers: **who can invoke what**, independent of “happy path”.

### 23.1 Outbox worker: QStash signature is fail-closed in prod; escape hatch is explicit

```9:13:app/api/workers/oci/process-outbox/route.ts
 * Auth: requireQstashSignature (also accepts the internal worker auth path
 *       so ops scripts can call it directly with CRON_SECRET).
```

```78:80:app/api/workers/oci/process-outbox/route.ts
export const POST = requireQstashSignature(
  processOutboxWorkerHandler as (req: NextRequest) => Promise<Response>
);
```

`requireQstashSignature` documents production behavior: verify signatures; missing keys → **503** unless internal worker auth matches `CRON_SECRET` + marker header.

```14:19:lib/qstash/require-signature.ts
 * BEHAVIOUR:
 * - Production: Always verify. If QSTASH_CURRENT_SIGNING_KEY is missing -> 503 (fail-closed).
 * - Non-production without ALLOW_INSECURE_DEV_WORKER=true: Same as production (verify or 503).
 * - Non-production with ALLOW_INSECURE_DEV_WORKER=true: Bypass verification (handler only).
 *
 * There is no code path in production where the worker runs without signature verification.
```

**Deep residual risk:** non-prod misconfiguration (`ALLOW_INSECURE_DEV_WORKER=true`) is an explicit foot-gun; acceptable for local dev only if never present in preview/prod envs.

### 23.2 Cron path: hybrid provenance + bearer in production

```1:6:lib/cron/require-cron-auth.ts
/**
 * Cron auth guard: production hybrid mode is dual-key.
 * - Provenance: x-vercel-cron=1 + x-vercel-id
 * - Execution: Authorization: Bearer ${CRON_SECRET}
 * Header provenance alone is never enough to execute in production.
 */
```

```54:57:lib/cron/require-cron-auth.ts
  if (isProduction) {
    return hasTrustedVercelProvenance && hasValidBearer
      ? null
      : new Response(CRON_FORBIDDEN_JSON, { status: 403, headers: JSON_403_HEADERS });
```

**Deep note:** this is materially stronger than “Vercel header only.” The remaining class of issues is **secret distribution** (CRON_SECRET leakage / rotation) rather than header spoofing alone.

### 23.3 Script ACK: optional JWS; legacy path still exists when signature absent

```50:67:app/api/oci/ack/route.ts
    // Phase 8.2: JWS Asymmetric Signature Verification (Optional enforcement)
    // If signature is present, we verify. If not, we fall back to API Key / Session auth.
    const signature = req.headers.get('x-oci-signature');
    const publicKeyB64 = process.env.VOID_PUBLIC_KEY;
    if (publicKeyB64 && signature) {
      try {
        const publicKey = await jose.importSPKI(Buffer.from(publicKeyB64, 'base64').toString('utf8'), 'RS256');
        await jose.jwtVerify(signature, publicKey, {
          issuer: 'opsmantik-oci-script',
          audience: 'opsmantik-api',
        });
      } catch (err) {
        logError('OCI_ACK_CRYPTO_MISMATCH', { error: err instanceof Error ? err.message : String(err) });
        return NextResponse.json({ error: 'Cryptographic Mismatch', code: 'AUTH_FAILED' }, { status: 401 });
      }
    } else if (publicKeyB64 && !signature) {
      logInfo('OCI_ACK_SIMPLE_AUTH', { msg: 'No crypto signature; proceeding with API Key validation.' });
    }
```

**Deep implication:** the ACK endpoint is a **high-value state transition** surface (queue/marketing_signals/Redis). Crypto is “best when configured,” not mandatory. Red-team stance: treat API key compromise as **full ACK forge** until JWS is enforced end-to-end for all script tenants.

---

## 24) OCI Ledger Tables: RLS Enabled + Broad GRANT — Nuanced Blast Radius

Evidence that **RLS is enabled** on the new ledger tables:

```914:915:supabase/migrations/20261223020200_oci_queue_transitions_ledger_and_claim_rpcs.sql
ALTER TABLE public.oci_payload_validation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oci_queue_transitions ENABLE ROW LEVEL SECURITY;
```

This migration **does not** create `CREATE POLICY ...` statements for these tables in-file. In PostgreSQL, **RLS enabled with zero policies** yields **deny-by-default** for roles that are not the table owner/superuser (for typical DML/SELECT through the SQL engine).

Simultaneously, the migration ends with broad grants:

```934:949:supabase/migrations/20261223020200_oci_queue_transitions_ledger_and_claim_rpcs.sql
GRANT ALL ON TABLE public.oci_payload_validation_events TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.oci_queue_transitions TO anon, authenticated, service_role;

GRANT ALL ON FUNCTION public.oci_transition_payload_allowed_keys() TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.oci_transition_payload_missing_required(text, jsonb) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.oci_transition_payload_unknown_keys(jsonb) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.queue_transition_clear_fields(jsonb) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.queue_transition_payload_has_meaningful_patch(jsonb) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.log_oci_payload_validation_event(text, uuid, uuid, text, jsonb, text[], text[], text) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.apply_snapshot_batch(uuid[]) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.assert_latest_ledger_matches_snapshot(uuid[]) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.apply_oci_queue_transition_snapshot() TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.append_rpc_claim_transition_batch(uuid[], timestamptz) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.append_script_claim_transition_batch(uuid[], timestamptz) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.append_script_transition_batch(uuid[], text, timestamptz, jsonb) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.claim_offline_conversion_rows_for_script_export(uuid[], uuid) TO anon, authenticated, service_role;
```

**Deep synthesis:**

| Mechanism | Effect today (typical) |
|-----------|-------------------------|
| `SECURITY DEFINER` + `auth.role() = service_role` gate | Mutating RPCs refuse anon/authenticated even if `EXECUTE` is granted. |
| RLS on tables + no permissive policies | Direct PostgREST table access should return **no rows / RLS failures** for anon/authenticated. |
| `log_oci_payload_validation_event` **not** `SECURITY DEFINER` | If invoked as anon, the `INSERT` runs as invoker → should fail under deny-by-default RLS (noise / confusion, not privilege escalation by itself). |

**Why this is still P0 posture debt (not “already safe”):**

1. **Future-policy regression:** the next engineer adding `FOR ALL USING (true)` (or overly broad `authenticated`) to “fix” a dashboard query turns broad `GRANT ALL` into a catastrophic leak.
2. **Supabase advisor / org standards:** `GRANT ALL` to `anon`/`authenticated` is a red flag independent of current RLS emptiness.
3. **Attack surface enumeration:** exposing `EXECUTE` on powerful DEFINER RPCs to `anon` increases the payoff of any **single** missing/incorrect `auth.role()` check in a future edit.

---

## 25) Interleaved Client Timelines (What Breaks Without Serialisation)

Representative race (not proven failing; **stress hypothesis**):

1. Tab A: stage transition RPC commits `calls.status = offered`.
2. Tab B: seal / junk transition for same call fires before A’s client receives response.
3. Producer runs twice; outbox may receive two `PENDING` rows (allowed by schema); consumer must converge.

**Deep mitigations already in play:** DB versioning / merge semantics / downstream unique indexes (see §18.3). **Deep weakness:** HTTP/`success` + notify gating can make operators believe a specific attempt “won” when it was superseded.

---

## 26) Idempotency & Dedupe Keys — Cross-Layer Map (Compressed)

| Layer | Primary dedupe / idempotency anchor | Failure if wrong |
|------:|-------------------------------------|------------------|
| Ingest | `events.ingest_dedup_id` partial unique | duplicate raw events |
| Intent/call | `calls_site_event_id_uniq`, `calls_site_signature_hash_uq`, canonical intent key | duplicate intents |
| Session card | `idx_calls_active_click_single_card_per_session` | duplicate active cards |
| Outbox | *convergence*, not strict single-row pending uniqueness | queue depth / cost |
| Signals | `(site_id, call_id, google_conversion_name, adjustment_sequence)` unique | duplicate Google signal rows |
| Offline queue | provider external id / session pending unique patterns | duplicate uploads |

**Deep audit takeaway:** OpsMantik is **intentionally asymmetric**: strict uniqueness at “business object” layers, softer uniqueness at outbox burst layer. That is defensible **only** if observability proves convergence SLIs.

_Remediation approval gate unchanged — explicit A/B/C scope before implementation (see §17/§22)._

---

## 27) Post-Remediation Reconcile (2026-05-05)

This section maps earlier high-risk findings to current implementation status.

| Finding | Previous | Current | Evidence |
|--------|----------|---------|----------|
| Broad GRANT surface on OCI transition objects | Fail / P0 | Pass | `supabase/migrations/20261226000000_oci_transition_grants_revoke_apply_call_action_strict.sql` + remote MCP grant proof |
| Route success semantics vs producer durability | Fail / P1 | Partial Pass | `lib/oci/panel-oci-response.ts`; stage/status/seal now expose classification + fail-closed gate (`OCI_PANEL_OCI_FAIL_CLOSED`) |
| notify/trigger fired without outbox artifact | Fail / P1 | Pass | stage/status/seal now call notify only when `oci.outboxInserted` is true |
| `apply_call_action_v2` silent coercion to `intent` | Fail / P1 | Pass | strict `invalid_stage` exception in `20261226000000_..._strict.sql` |
| Outbox pre-dedupe missing | Partial Fail / P1 | Pass | `idx_outbox_events_pending_site_call_stage_uq` + 23505 idempotent producer path |
| ACK app-clock drift | Partial Fail / P1-P2 | Pass | `app/api/oci/ack/route.ts` now uses `getDbNowIso()` |
| Script secret hygiene | Fail / P0 | Partial Pass | leaked inline literals removed + scanner hardened; key rotation remains operational task |
| ACK crypto optional fallback | Open risk | Partial Pass | feature gate `OCI_ACK_REQUIRE_SIGNATURE` added; full tenant rollout pending |
| SLO/incident closure | Partial | Pass | `docs/OPS/OCI_REMEDIATION_INCIDENT_AND_SLO.md` thresholds + alarm mapping |
| GDPR retention/PII controls | Partial | Partial Pass | reconciliation payload sanitizer + backlog owners documented; retention jobs pending legal windows |

Residual open items are intentionally tracked as operational rollout tasks (key rotation, JWS enforcement rollout, retention job implementation).


