# PR-C4 Report: Worker Decomposition + Single Runner

**Goal:** Merge two worker implementations into one OCI runner; routes become thin callers. No behavior change.

**Production hardening (finalize):** Exhaustive mode switch, shared `persistProviderOutcome`, transaction-safety audit, failure-parity verification, logging standardization, runtime safeguard for worker + providerKey.

---

## Summary

- **New:** `lib/oci/constants.ts` — shared `MAX_RETRY_ATTEMPTS`, `BATCH_SIZE_WORKER`, `DEFAULT_LIMIT_CRON`, `MAX_LIMIT_CRON`, `LIST_GROUPS_LIMIT`.
- **New:** `lib/oci/runner.ts` — single `runOfflineConversionRunner(options)` implementing:
  - **mode: 'worker'** — single provider (e.g. `google_ads`), semaphore (PR11), ledger (provider_upload_attempts), full queue columns (uploaded_at, provider_request_id, provider_error_*).
  - **mode: 'cron'** — optional provider filter, health gate (OPEN/HALF_OPEN/CLOSED), backlog-weighted claim, `increment_provider_upload_metrics`, record_provider_outcome; simpler queue updates.
- **Thin routes:**
  - `app/api/workers/google-ads-oci/route.ts` — auth + `runOfflineConversionRunner({ mode: 'worker', providerKey: 'google_ads', logPrefix })` + response.
  - `app/api/cron/process-offline-conversions/route.ts` — auth + query (provider_key, limit) + `runOfflineConversionRunner({ mode: 'cron', providerFilter, limit, logPrefix })` + response.
- **Tests:** Source-based tests now assert against `lib/oci/runner.ts` (and `lib/oci/constants.ts` where needed) for implementation details; route tests assert route calls runner with correct options.

---

## Safety Improvements (Production Hardening)

| Step | Improvement |
|------|-------------|
| **1. Exhaustive mode** | `switch(mode)` with `default: const _exhaustive: never = mode` so adding a new mode without handling it fails compilation. |
| **2. Shared persistence** | `persistProviderOutcome(siteId, providerKey, isSuccess, isTransient, prefix)` — both worker and cron call this; no duplicated `record_provider_outcome` logic. |
| **3. Transaction safety** | Audited: `claim_offline_conversion_jobs_v2` (migration 20260220110000) uses `FOR UPDATE SKIP LOCKED`; no schema change. Queue updates are per-row atomic. |
| **4. Failure parity** | Both modes use `MAX_RETRY_ATTEMPTS` from `constants.ts`, increment `retry_count`, and respect final attempt → FAILED. Worker sets `provider_error_code` / `provider_error_category`; cron sets `last_error`. |
| **5. Logging** | `logGroupOutcome(prefix, mode, providerKey, claimed_count, success_count, failure_count, retry_count)` after each group; `run_complete` summary at end. Same `logPrefix` for all runner logs. |
| **6. Production safeguard** | `if (mode === 'worker' && !providerKey) throw new Error('OCI runner: mode worker requires providerKey')`. |
| **7. Build/test** | Lint 0 errors, unit tests pass, no snapshot drift. |

---

## Files Changed

| File | Change |
|------|--------|
| `lib/oci/constants.ts` | **New** — shared OCI constants |
| `lib/oci/runner.ts` | **New** — single runner (claim, gates, adapter, persist) |
| `app/api/workers/google-ads-oci/route.ts` | **Replaced** — ~535 → ~55 lines; delegates to runner |
| `app/api/cron/process-offline-conversions/route.ts` | **Replaced** — ~447 → ~55 lines; delegates to runner |
| `tests/unit/process-offline-conversions.test.ts` | **Updated** — PR6 test checks route + runner; PR7 test reads runner |
| `tests/unit/providers-worker-loop.test.ts` | **Updated** — implementation assertions target runner (and constants); route still checked for auth / runner invocation |
| `lib/oci/runner.ts` (hardening) | **Updated** — exhaustive switch, `persistProviderOutcome`, `logGroupOutcome`, run_complete log, production safeguard, file-header audit comment |

---

## Verification

- **Lint:** `npm run lint` — 0 errors (existing warnings unchanged).
- **Tests:** `npm run test:unit` — 212 tests, 0 fail.
- **Build:** `npm run build` — success.

**Confirmation:** No behavior change. Same RPCs, same queue updates, same ledger/metrics; only structure and safety additions.

**Merge ready:** Yes.

---

## PR Title & Description

**Title:** `PR-C4: OCI single runner — worker decomposition, no behavior change`

**Description:**

- Add `lib/oci/runner.ts` with `runOfflineConversionRunner({ mode, providerKey?, providerFilter?, limit?, logPrefix? })`.
- Worker mode: google_ads only, semaphore, ledger, full proof fields.
- Cron mode: optional provider filter, health gate, backlog-weighted claim, metrics.
- Thin routes: `/api/workers/google-ads-oci` and `/api/cron/process-offline-conversions` only do auth, query parsing, and call runner.
- Shared constants in `lib/oci/constants.ts` (MAX_RETRY_ATTEMPTS, batch/limit caps).
- Unit tests updated to assert runner (and constants) for behavior; routes for auth and runner usage.
- Enables PR11/PR12 to be applied in one place (runner) without duplicating logic.
