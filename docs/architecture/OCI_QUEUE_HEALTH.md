# OCI Queue Health (operational)

Queue health scores measure **export pipeline reliability** (queue, retry, DLQ, stuck, won pipeline leak, SSOT flags). They are **not** `lead_score`, **not** Google conversion value, and **not** the closed-system optimization majors — see [CLOSED_SYSTEM_SCORE_CONTRACT.md](./CLOSED_SYSTEM_SCORE_CONTRACT.md).

## Canonical definitions

- **Queue lifecycle (states / transitions / approved writers):** [OCI_QUEUE_LIFECYCLE_CONTRACT.md](./OCI_QUEUE_LIFECYCLE_CONTRACT.md) — pairs with this doc: “100” requires coherent lifecycle (no silent illegal jumps; `stuck_processing` and DLQ/retry semantics align with §2–5 there).
- **TypeScript contract:** [lib/oci/queue-health-contract.ts](../../lib/oci/queue-health-contract.ts) — `QUEUE_HEALTH_POLICY_VERSION`, thresholds, `evaluateQueueHealth`, `evaluateRolloutGate`.
- **SQL pack (TARGET_DB evidence):** [scripts/sql/queue_health.sql](../../scripts/sql/queue_health.sql) — per-site row; `policy_version`, `contract_status`, `queue_health_status`, `blocking_reasons`.
- **Source matrix:** [OCI_QUEUE_HEALTH_SOURCES.md](./OCI_QUEUE_HEALTH_SOURCES.md).

## “100” vs rollout gate

- **Queue Health 100 / GREEN (kemik):** all invariants in the contract at once: no stuck processing (by `STUCK_PROCESSING_MAX_AGE_MINUTES`), no won pipeline leak (`won_missing_pipeline`), DLQ = 0, retry rate within max, **`actionable_failed_rate` and `provider_failed_rate`** within max (PR-1C — not raw `total_failed_rate` alone), age SLOs, no SSOT RED when `evaluationMode: 'kemik'`, and TARGET_DB evidence when asserting release claims. **Do not declare operational “100” from STATIC evidence alone** — see §Evidence; lifecycle contradictions (e.g. backlog green while `PROCESSING` zombies persist) are failures against [OCI_QUEUE_LIFECYCLE_CONTRACT.md](./OCI_QUEUE_LIFECYCLE_CONTRACT.md).
- **Rollout readiness gate** ([scripts/oci-rollout-readiness.ts](../../scripts/oci-rollout-readiness.ts)) uses **tolerant** `stuckMax` per profile (e.g. prod 20) and the same PR-1C **actionable / provider** failure rates; deterministic skips must **not** sole-fail the gate. **Any** non-zero `won_missing_pipeline` or DLQ count still fails the gate (aligned with `queue_health.sql`). That answers “can we ship observability”, **not** “perfect queue health”. Do not equate `stuck < 20` with score 100.

## Evidence (STATIC vs TARGET_DB)

- **STATIC** `release:evidence` proves SQL pack **shape** and repo tests — **not** live row counts.
- **TARGET_DB** requires `verify-db` / DB-connected evidence modes — never claim prod queue GREEN from STATIC-only artifacts.
- Release markdown includes `db_evidence_status`, `static_queue_contract_green`, and queue-health kanıt notes from [collect-gate-evidence.mjs](../../scripts/release/collect-gate-evidence.mjs).

## API (`queue-stats`)

`GET /api/oci/queue-stats` returns `queue_health_score`, `queue_health_status`, `blocking_reasons`, rates, ages, `failure_taxonomy` (counts), and `queue_health_evaluation_mode: 'operational'`. Full value-integrity drift is authoritative in `value_integrity_health.sql` (API uses partial SSOT flags for time + identity; value drift is not fully duplicated server-side).

**PR-1C — `FAILED` is not always a provider failure:** `status = FAILED` is a **lifecycle** terminal bucket. `provider_error_category = DETERMINISTIC_SKIP` marks **expected non-upload** outcomes (e.g. `SUPPRESSED_BY_HIGHER_GEAR`). Those rows stay **visible** in `failure_taxonomy` and in legacy **`failed_rate` / `total_failed_rate`** (FAILED + DLQ mass), but **`queue_health_score` / rollout gates** use **`actionable_failed_rate`** and **`provider_failed_rate`** so deterministic skips do not masquerade as Google/provider breakage. **`COMPLETED`** still means ACK-success / upload evidence only — see [OCI_QUEUE_LIFECYCLE_CONTRACT.md](./OCI_QUEUE_LIFECYCLE_CONTRACT.md) §5.

**Unknown failures:** `unknown_failed_count > 0` is **RED** when taxonomy is present (unclassified FAILED rows must not be ignored).

## Recovery (no deletes)

Do **not** DELETE queue rows; use terminalize / repair / manual actions documented in [OCI_HARDENING_OPERATIONS.md](../runbooks/OCI_HARDENING_OPERATIONS.md).

## ACK / ACK_FAILED (replay-safe semantics)

Production handlers:

- [app/api/oci/ack/route.ts](../../app/api/oci/ack/route.ts) — Google OK path; idempotent duplicate ACK should not double-advance lifecycle.
- [app/api/oci/ack-failed/route.ts](../../app/api/oci/ack-failed/route.ts) — TRANSIENT vs permanent categories drive RETRY vs terminal FAILED / DLQ per existing policy.

Unit coverage includes `oci-script-ack-failed` and ACK parity tests under `tests/unit/`. Do not redesign semantics in the queue-health contract PR — only document and extend tests if gaps are found.

## Google export surface (journal only)

- [`export-fetch.ts`](../../app/api/oci/google-ads-export/export-fetch.ts) reads **`offline_conversion_queue` only** — see [`EXPORT_CLOSURE.md`](./EXPORT_CLOSURE.md). Micro stages are written by [`enqueueOciConversionRow`](../../lib/oci/enqueue-oci-conversion-row.ts) from [`process-outbox.ts`](../../lib/oci/outbox/process-outbox.ts).
- **`marketing_signals`** is not merged into the script export batch; backlog/dispatch for that table is separate (recovery workers, ops). Optional gap heuristics: [`export_closure_stage_journal_gap.sql`](../../scripts/sql/export_closure_stage_journal_gap.sql).
- Fail-closed parity check: `scripts/sql/script_backlog_health.sql` reports `parity_enforcement_mode` + `marketing_signals_queue_parity_gap_count` for Google-eligible signal rows lacking a queue match. In `enforce` mode any non-zero gap is RED/release-blocking.
- Canonical Google-bound actions represented in queue journal: `OpsMantik_Contacted`, `OpsMantik_Offered`, `OpsMantik_Won`, `OpsMantik_Junk_Exclusion`.
- If fired stage is ineligible (missing click / consent / export gate), reason must remain explicit (`MISSING_CLICK_ID`, `CONSENT_MISSING`, or structured non-eligible reason). Silent disappearance is a contract violation.

## SRE follow-up (backoff, ACK_FAILED, DLQ autopsy)

- **Poison pill:** malformed rows are isolated in **`DEAD_LETTER_QUARANTINE`** by the conversion batch kernel ([process-conversion-batch-kernel.ts](../../lib/oci/runner/process-conversion-batch-kernel.ts)); see kernel tests for behavior.
- **Backoff + jitter:** `next_retry_at` uses `nextRetryDelaySecondsWithJitter` in the worker and kernel. Env **`OCI_RETRY_JITTER_MAX_SECONDS`** (default `60`, `0` disables, max `600`). Shared ACK_FAILED TRANSIENT retry time uses the **max** `attempt_count` among retryable seal rows with the same jitter helper ([ack-failed/route.ts](../../app/api/oci/ack-failed/route.ts)).
- **DLQ autopsy:** `npm run oci:dlq-autopsy` (optional `--json`, `--site=<uuid|public_id|fragment>`) — read-only summary by `provider_error_code` for `FAILED` / `DEAD_LETTER_QUARANTINE`. Runbook: [OCI_SRE_QUEUE_FOLLOWUP.md](../runbooks/OCI_SRE_QUEUE_FOLLOWUP.md).
- **Per-site puan (TARGET_DB):** `npm run oci:queue-health-snapshot` — `queue-stats` ile aynı girdiler; `queue_health_score` (100 veya 0), `blocking_reasons`; `--json`.
