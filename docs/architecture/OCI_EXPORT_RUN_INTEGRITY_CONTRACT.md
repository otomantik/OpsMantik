# OCI Export Run Integrity Contract

This document defines the formal export run integrity contract and reconciliation equations for the Google Ads offline conversion pipeline.

## Core Directives
- **fetched != claimed is run failure:** An export run cannot proceed or claim success unless fetched rows are deterministically claimed.
- **export response must contain only claimed rows:** The script must never receive rows that the DB failed to mark as `PROCESSING`.
- **script classification must reconcile with ACK/ACK_FAILED:** Script totals must match DB transition ACKs.
- **ACK/ACK_FAILED must reconcile with DB transition results:** DB RPCs must update exactly the number of rows submitted by the ACK routes.
- **false success is forbidden:** Partial failures, missing DB state updates, or script crashes must be flagged as run failures.
- **exactly-once is not assumed:** The system operates under the presumption of **at-least-once transport + idempotent commit**.
- **no proof means EXPORT_RUN_INTEGRITY_UNVERIFIED, not green:** Without target database evidence and structured log proofs of reconciliation, release gates cannot blindly claim run integrity is green.
- **stuck PROCESSING recovery is outcome-aware:** `PROCESSING` recovery is not age-only; provider-attempt ambiguity must be classified before requeue.

## Definitions
- **export run:** A single execution cycle involving DB fetch, claim, script processing, and DB ACK transitions.
- **fetched rows:** The deterministic set of rows returned by `export-fetch` based on status (`QUEUED`/`RETRY`), cursor, and limit.
- **claimed rows:** The subset of fetched rows atomically transitioned to `PROCESSING` by the claim RPC.
- **script classification:** The Google Apps Script’s determination of each row’s outcome (`uploadable`, `skipped`, `failed_to_classify`).
- **ACK_SUCCESS:** A backend notification that a row was successfully accepted by Google Ads.
- **ACK_FAILED:** A backend notification that a row was rejected by Google Ads or encountered an internal script exception.
- **DB transition count:** The literal number of rows modified by the database RPC handling the ACK.
- **run status:** The holistic outcome of an export run (e.g., `PASS`, `PARTIAL_FAIL`, `FAIL`).
- **partial fail:** A run where some rows successfully transition to terminal states but others get stuck or drop due to classification/ACK drift.
- **fail:** A catastrophic mismatch (e.g., `QUEUE_CLAIM_MISMATCH`) or total script crash.
- **export run integrity green:** All reconciliation equations perfectly balance across fetch, claim, script, and ACK transitions.
- **export run integrity unverifiable:** A state where insufficient structured lineage exists to prove equations (currently the case without `run_id`).

## Export Run Lineage (`export_run_id`)
- `export_run_id` is for lineage correlation only.
- `export_run_id` is strictly **NOT** conversion identity. `external_id` remains the true conversion identity.
- export_run_id is strictly **NOT** conversion identity (plain-text pin for test contracts).
- `export_run_id` is generated dynamically per request. Randomness is permitted here because it does not affect deterministic conversion IDs.
- Supplying `export_run_id` back to the backend in ACK routes is currently optional and backward-compatible. Strict enforcement is deferred.
- Structured logs emit `export_run_id` to correlate fetch, claim, and ACK phases across the lifecycle.
- Without a fully enforced and perfectly reconciled DB proof, the release state remains `EXPORT_RUN_INTEGRITY_UNVERIFIED`.


## Reconciliation Equations

| Equation | Current support | Evidence | Gap | Next PR |
|---|---|---|---|---|
| **A. fetched_count = claimed_count** | ENFORCED | `export-mark-processing` throws `QUEUE_CLAIM_MISMATCH` | HTTP 409 thrown but lacks `run_id` structured log | PR-3B (Lineage) |
| **B. claimed_count = script_uploadable_count + script_skipped_count + script_failed_to_classify_count** | OPTIONAL_ENFORCED | Script sends summary via `export-run-summary` | Strict summary enforcement deferred | COMPLETED |
| **C. script_upload_attempted_count = ack_success_count + ack_failed_count + provider_ambiguous_pending_count** | OPTIONAL_ENFORCED | Script sends summary via `export-run-summary` | Strict summary enforcement deferred | COMPLETED |
| **D. ack_success_count + ack_failed_count = db_transition_success_count + db_transition_failed_count** | ENFORCED | ACK endpoints throw `DB_TRANSITION_MISMATCH` | None | COMPLETED |
| **E. terminalized_count = completed_count + failed_count + dead_letter_count + deterministic_skip_count** | PARTIALLY_ENFORCED | `queue_health.sql` pack | Exists globally per site, but not scoped to specific runs | Keep globally scoped |

## Current Flow Audit Matrix

| Step | File/function | Current behavior | Evidence | Gap | PR-3 follow-up |
|---|---|---|---|---|---|
| export route entry | `google-ads-export/route.ts` | Authenticates, builds context | None | No `run_id` | PR-3B injects `run_id` |
| fetch queue rows | `export-fetch.ts` | Selects `QUEUED`/`RETRY` | DB query | No lineage | None (deterministic) |
| build export items | `export-build-items.ts` | Normalizes format, identifies blocked | Memory | None | None |
| mark processing / claim | `export-mark-processing.ts` | Throws `QUEUE_CLAIM_MISMATCH` if mismatch | HTTP 409 | No structured run log on mismatch | PR-3B logs mismatch |
| response to script | `google-ads-export/route.ts` | Returns JSON payload | Network | Uncorrelated | Send `run_id` header |
| script upload classification | Google Apps Script | Posts summary to backend | `export-run-summary` endpoint logs | Summary is currently optional | Strict mode enforces |
| ACK success | `ack/route.ts` | Marks `COMPLETED` and asserts count | `DB_TRANSITION_MISMATCH` | None | COMPLETED |
| ACK failed | `ack-failed/route.ts` | Marks `FAILED`/`RETRY` and asserts count | `DB_TRANSITION_MISMATCH` | None | COMPLETED |
| stale PROCESSING recovery | `sweep-zombies/route.ts` | Legacy age-based reset path (RPC currently blind to provider-attempt ambiguity) | `recover_stuck_offline_conversion_jobs` | Duplicate upload risk if upload happened but ACK failed | PR-4 introduces explicit recovery taxonomy/evidence and strict gating vocabulary |
| release evidence | `collect-gate-evidence.mjs` | Proves queue taxonomy & eq presence | `queue_health.sql` + Evidence JSON | Evaluates strict mode policy | COMPLETED |

## Strict Mode Promotion Policy
- **Static Contract Green**: A valid local/CI state but is NOT runtime green.
- **Strict Mode Promotion**: Requires either an `EXPORT_RUN_INTEGRITY_GREEN` status, or an explicit waiver.
- **UNVERIFIED / PARTIAL**: Acceptable in development, but block strict mode promotion unless waived.
- **RED**: A hard blocker. Invalid summaries or equation mismatches fail immediately.
- **Waivers**: Required when promoting with missing runtime evidence. Must include owner, reason, blast radius, and expiry. Expired waivers fail.

## PR-4 Processing Recovery Taxonomy

For stuck `PROCESSING` rows, classify provider outcome before any retry action:

- `PROVIDER_NOT_ATTEMPTED`
- `PROVIDER_UPLOAD_ATTEMPTED`
- `PROVIDER_ACCEPTED_ACKED`
- `PROVIDER_REJECTED_ACKED`
- `PROVIDER_AMBIGUOUS_PENDING`
- `ACK_ENDPOINT_UNAVAILABLE_AFTER_UPLOAD`
- `SCRIPT_CRASHED_BEFORE_UPLOAD`
- `SCRIPT_CRASHED_AFTER_UPLOAD`
- `SCRIPT_SUMMARY_MISSING`
- `UNKNOWN_PROVIDER_OUTCOME`

Safety rule: only `PROVIDER_NOT_ATTEMPTED` / `SCRIPT_CRASHED_BEFORE_UPLOAD` are safe auto-retry candidates. Ambiguous or unknown provider outcome must be hold/review/quarantine and never silently marked `COMPLETED`.

PR-4C scope: classifier only (pure, non-mutating). Existing recovery cron/RPC behavior is intentionally not flipped in this PR.
PR-4D scope: guarded runtime adoption via `OCI_PROCESSING_RECOVERY_CLASSIFIER_MODE` with safe default.

Runtime modes:

- `off`: unchanged legacy recovery.
- `shadow`: classifier-only observability, no mutation change.
- `enforce_safe_retry` / `strict`: only `SAFE_TO_RETRY` should auto-retry; ambiguous/unknown outcomes are never safe-to-retry.

PR-4D.1 additive support: `recover_safe_processing_queue_rows_v1` provides row-scoped stale PROCESSING recovery for classifier-approved IDs. Legacy `recover_stuck_offline_conversion_jobs` remains available for compatibility.

Runtime enforcement contract:

- only `SAFE_TO_RETRY` classified IDs may be sent to row-scoped recovery RPC,
- ambiguous/unknown/review buckets are not blindly retried,
- if row-scoped RPC is unavailable, enforcement is not falsely claimed.

PR-4E note: recovery integrity (`RECOVERY_INTEGRITY_*`) is evaluated as a separate gate from export-run integrity (`EXPORT_RUN_INTEGRITY_*`). A static/export contract green result must not be interpreted as runtime recovery green.

## PR-6 Target DB Evidence Requirement

- `STATIC_CONTRACT_GREEN` means repo contracts/tests are present; it is not target DB proof.
- Promotion-safe claims require target DB evidence status (`TARGET_DB_GREEN` / `TARGET_DB_RED` / `TARGET_DB_UNVERIFIED`) from release artifacts.
- `TARGET_DB_NOT_CHECKED` and `DB_ENV_MISSING` are never treated as runtime green in strict staging/production.
- For production sign-off, archive production artifacts (`release-gates-production.*`, `release-gates-latest.*`, `db-evidence-latest.*`) with matching `generated_at`.
- RPC/signature/grant drift in target DB are release blockers even when static evidence is green.
