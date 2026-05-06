# OCI Queue Health (operational)

Queue health scores measure **export pipeline reliability** (queue, retry, DLQ, stuck, won pipeline leak, SSOT flags). They are **not** `lead_score`, **not** Google conversion value, and **not** the closed-system optimization majors — see [CLOSED_SYSTEM_SCORE_CONTRACT.md](./CLOSED_SYSTEM_SCORE_CONTRACT.md).

## Canonical definitions

- **TypeScript contract:** [lib/oci/queue-health-contract.ts](../../lib/oci/queue-health-contract.ts) — `QUEUE_HEALTH_POLICY_VERSION`, thresholds, `evaluateQueueHealth`, `evaluateRolloutGate`.
- **SQL pack (TARGET_DB evidence):** [scripts/sql/queue_health.sql](../../scripts/sql/queue_health.sql) — per-site row; `policy_version`, `contract_status`, `queue_health_status`, `blocking_reasons`.
- **Source matrix:** [OCI_QUEUE_HEALTH_SOURCES.md](./OCI_QUEUE_HEALTH_SOURCES.md).

## “100” vs rollout gate

- **Queue Health 100 / GREEN (kemik):** all invariants in the contract at once: no stuck processing (by `STUCK_PROCESSING_MAX_AGE_MINUTES`), no won pipeline leak, DLQ = 0, retry/failed rates within max, age SLOs, no SSOT RED when `evaluationMode: 'kemik'`, and TARGET_DB evidence when asserting release claims.
- **Rollout readiness gate** ([scripts/oci-rollout-readiness.ts](../../scripts/oci-rollout-readiness.ts)) uses **tolerant** `stuckMax` per profile (e.g. prod 20) — that answers “can we ship observability”, **not** “perfect queue health”. Do not equate `stuck < 20` with score 100.

## Evidence (STATIC vs TARGET_DB)

- **STATIC** `release:evidence` proves SQL pack **shape** and repo tests — **not** live row counts.
- **TARGET_DB** requires `verify-db` / DB-connected evidence modes — never claim prod queue GREEN from STATIC-only artifacts.
- Release markdown includes `db_evidence_status`, `static_queue_contract_green`, and queue-health kanıt notes from [collect-gate-evidence.mjs](../../scripts/release/collect-gate-evidence.mjs).

## API (`queue-stats`)

`GET /api/oci/queue-stats` returns `queue_health_score`, `queue_health_status`, `blocking_reasons`, rates, ages, and `queue_health_evaluation_mode: 'operational'`. Full value-integrity drift is authoritative in `value_integrity_health.sql` (API uses partial SSOT flags for time + identity; value drift is not fully duplicated server-side).

## Recovery (no deletes)

Do **not** DELETE queue rows; use terminalize / repair / manual actions documented in [OCI_HARDENING_OPERATIONS.md](../runbooks/OCI_HARDENING_OPERATIONS.md).

## ACK / ACK_FAILED (replay-safe semantics)

Production handlers:

- [app/api/oci/ack/route.ts](../../app/api/oci/ack/route.ts) — Google OK path; idempotent duplicate ACK should not double-advance lifecycle.
- [app/api/oci/ack-failed/route.ts](../../app/api/oci/ack-failed/route.ts) — TRANSIENT vs permanent categories drive RETRY vs terminal FAILED / DLQ per existing policy.

Unit coverage includes `oci-script-ack-failed` and ACK parity tests under `tests/unit/`. Do not redesign semantics in the queue-health contract PR — only document and extend tests if gaps are found.

## Future work (separate PRs — behavior change)

Poison-pill isolation, exponential backoff + jitter for retries, DLQ autopsy reporting — **not** part of the contract measurement PR; implement as follow-up PRs only.
