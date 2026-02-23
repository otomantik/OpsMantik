# PR-C4 Merge and Smoke

## 1) Branch and checks

- **Branch:** master (up to date with origin/master after fetch).
- **Lint:** `npm run lint` — 0 errors, 37 existing warnings.
- **Tests:** `npm run test:unit` — 212 tests, 206 pass, 0 fail (6 skipped).
- **Build:** `npm run build` — success.

## 2) Behavioral verification

- No behavior change: only structural refactor (single runner, thin routes) and safety guards (exhaustive mode, `persistProviderOutcome`, logging, worker + providerKey check). Same RPCs, same queue/ledger updates.

## 3) Merge (squash commit)

- **Commit hash:** `e8ed3d9`
- **Message:** `PR-C4: OCI single runner - worker decomposition, no behavior change`
- **Files in commit:** 9 files, +1177 / -438
  - `app/api/workers/google-ads-oci/route.ts` (new)
  - `app/api/cron/process-offline-conversions/route.ts` (modified)
  - `lib/oci/constants.ts`, `lib/oci/runner.ts` (new)
  - `lib/providers/limits/semaphore.ts` (new)
  - `tests/unit/process-offline-conversions.test.ts`, `tests/unit/providers-worker-loop.test.ts`, `tests/unit/semaphore.test.ts` (modified/new)
  - `docs/OPS/PR-C4_REPORT.md` (new)

## 4) Smoke (local / post-merge)

- **POST /api/workers/google-ads-oci**  
  - Result: 200, `{"ok":true,"processed":0,"completed":0,"failed":0,"retry":0}`  
  - Trigger: `node scripts/trigger-google-ads-oci-worker.mjs [baseUrl]`

- **POST /api/cron/process-offline-conversions?limit=10**  
  - Result: 200, `ok: true`, `processed: 0`  
  - Trigger: `POST` with `Authorization: Bearer $CRON_SECRET`

- **Logs:** `run_complete` summaries are emitted by the runner at the end of each run. Check server stdout (e.g. Vercel logs or local `next start` / `npm run dev`) for lines like:
  - `[google-ads-oci] run_complete mode=worker processed=0 completed=0 failed=0 retry=0`
  - `[process-offline-conversions] run_complete mode=cron processed=0 completed=0 failed=0 retry=0`

## 5) Anomalies

- None. Both endpoints returned 200 with no jobs in queue (`processed: 0`). For production, run the same requests against the production base URL and confirm `run_complete` in production logs.
