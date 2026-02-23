# Providers upload runbook (Google Ads OCI)

- **Worker:** `POST /api/cron/process-offline-conversions` (claim → decrypt creds → upload → update status). Vercel: every 10 min (`vercel.json`). **PR6:** Claim is per (site_id, provider_key) via `list_offline_conversion_groups` + `claim_offline_conversion_jobs_v2(site_id, provider_key, limit)`; ordering `next_retry_at ASC NULLS FIRST`, `created_at ASC`. **PR7:** `list_offline_conversion_groups` returns `queued_count`, `min_next_retry_at`, `min_created_at`; CLOSED groups use **backlog-weighted fair share** (claim limit ∝ queued_count / totalQueued, min 1, cap sum ≤ limit, leftover round-robin); OPEN skipped, HALF_OPEN uses `probe_limit`.
- **Recovery:** `POST /api/cron/providers/recover-processing` (requeue stuck PROCESSING jobs). Vercel: every 30 min (`vercel.json`). **PR7:** Recovery RPC uses `claimed_at < now() - interval` (fallback `updated_at` when `claimed_at` is null); moves to QUEUED; service_role only.
- **Seed (staging only):** `POST /api/cron/providers/seed-credentials` — **hard-blocked in production** (`NODE_ENV === 'production'` returns 403). Use only in staging.

## Required env vars

| Variable | Purpose |
|----------|---------|
| `OPSMANTIK_VAULT_KEY` | Base64 32-byte key for encrypting/decrypting provider credentials. Required for worker and seed. |
| `CRON_SECRET` | Bearer token for cron routes (or use x-vercel-cron: 1 in Vercel). |

## Seeding credentials (staging)

1. Get Google Ads OAuth credentials (customer_id, developer_token, client_id, client_secret, refresh_token, conversion_action_resource_name).
2. Call seed-credentials with cron auth.

**Windows (PowerShell, curl.exe):**

```powershell
$baseUrl = "https://<host>"
$body = '{"site_id":"<site_uuid>","provider_key":"google_ads","credentials":{"customer_id":"...","developer_token":"...","client_id":"...","client_secret":"...","refresh_token":"...","conversion_action_resource_name":"customers/123/conversionActions/456"}}'
curl.exe -X POST "$baseUrl/api/cron/providers/seed-credentials" -H "Authorization: Bearer $env:CRON_SECRET" -H "Content-Type: application/json" -d $body
```

3. **Production:** Seed-credentials returns 403 in production; no action needed. For prod creds use a secure admin flow or one-off script only.

## Smoke steps

1. **Create a confirmed sale** (via app or API) that has gclid/wbraid/gbraid and is linked to a conversation.
2. **Ensure queue row QUEUED:** Check `offline_conversion_queue` for that sale (e.g. `SELECT * FROM offline_conversion_queue WHERE sale_id = '<id>'`).
3. **Run worker (smoke):** Set `$baseUrl` and run — expects `200` and `{ "ok": true, "processed": N, ... }`. Ensure `$env:CRON_SECRET` is set (or use your cron secret in the header). (Do not use `$host` — it is read-only in PowerShell.)

**Windows (PowerShell, curl.exe):**

```powershell
$baseUrl = "https://<prod-host>"
# $env:CRON_SECRET = "your-cron-secret"   # if not already set
curl.exe -X POST "$baseUrl/api/cron/process-offline-conversions?limit=50" -H "Authorization: Bearer $env:CRON_SECRET"
```

4. **Verify status:** Row should move to COMPLETED (or RETRY/FAILED with last_error). Check response body: `{ ok: true, processed, completed, failed, retry }`.
5. **Recovery (optional):** If jobs are stuck in PROCESSING (e.g. worker crash), run:

```powershell
curl.exe -X POST "$baseUrl/api/cron/providers/recover-processing?min_age_minutes=15" -H "Authorization: Bearer $env:CRON_SECRET"
```

## Rollback

- **Disable cron:** Remove or pause `process-offline-conversions` in Vercel crons so no new claims occur.
- **Stuck PROCESSING:** Run recover-processing to move them back to QUEUED, or manually `UPDATE offline_conversion_queue SET status = 'QUEUED' WHERE status = 'PROCESSING'` (with caution).
- **Bad credentials:** Fix or replace credentials for the site (re-seed or admin flow); failed rows stay FAILED until manually re-queued if desired.

## Claim (PR6 + PR7)

- **Per-group claim:** Worker calls `list_offline_conversion_groups(p_limit_groups)` then for each group `claim_offline_conversion_jobs_v2(p_site_id, p_provider_key, p_limit)`. Only rows with `site_id` and `provider_key` matching the group are claimed; strict tenant isolation.
- **PR7 list_offline_conversion_groups returns:** `site_id`, `provider_key`, `queued_count`, `min_next_retry_at`, `min_created_at`. `queued_count` = count of eligible rows (status IN QUEUED/RETRY, next_retry_at IS NULL OR next_retry_at <= now()). Ordering deterministic: `ORDER BY min_next_retry_at ASC NULLS FIRST, min_created_at ASC`.
- **Limit per group (PR7 backlog-weighted):** OPEN → skip. HALF_OPEN → claim up to `probe_limit`. CLOSED → **backlog-weighted fair share:** `totalQueued = sum(queued_count)` of CLOSED groups; per group `claimLimit = max(1, floor(limit * (queued_count / totalQueued)))`; if sum > limit decrement from largest until sum ≤ limit (tie-break: min_next_retry_at ASC NULLS FIRST, min_created_at ASC for determinism); distribute leftover round-robin so total claimed ≤ limit; min 1 per group when remaining allows (no starvation).
- **Ordering:** Eligible rows selected with `ORDER BY next_retry_at ASC NULLS FIRST, created_at ASC` for deterministic, fair processing.
- **Status set:** QUEUED and RETRY are both first-class (G4 schema); eligible = status IN (QUEUED, RETRY) and (next_retry_at IS NULL OR next_retry_at <= now()).

## Circuit breaker (PR5)

- **States (per site_id + provider_key):** `CLOSED` (normal), `OPEN` (no uploads until probe time), `HALF_OPEN` (probe run).
- **Threshold:** 5 transient failures in a row → circuit opens (`OPEN`). Stored in `provider_health_state` (failure_count, state, next_probe_at).
- **Jitter:** When opening: `next_probe_at = now() + 5 minutes + random(0–60s)`. When gating (OPEN, not yet probe time): queue rows get `next_retry_at = next_probe_at + random(0–30s)` and `last_error = CIRCUIT_OPEN`.
- **HALF_OPEN:** After `next_probe_at` the worker sets state to `HALF_OPEN` and processes at most **probe_limit** jobs (default 5) in that run; remaining jobs stay QUEUED for the next run. Success in HALF_OPEN → back to `CLOSED` and failure_count reset.
- **Success:** Any successful upload in a group → `record_provider_outcome(success)` → state `CLOSED`, failure_count = 0. Permanent (validation) failures do not increment failure_count and do not open the circuit.

## Observability

- **Worker response:** `processed`, `completed`, `failed`, `retry` counts per run.
- **Site-scoped counters:** Table `provider_upload_metrics` (site_id, provider_key, attempts_total, completed_total, failed_total, retry_total, updated_at). Written by the worker via RPC `increment_provider_upload_metrics` (service_role only). Use for dashboards or alerts per site.
- **Circuit state:** Table `provider_health_state` (site_id, provider_key, state, failure_count, next_probe_at, probe_limit). Use for debugging OPEN/HALF_OPEN.
- Optional: Watchtower can include queue backlog (QUEUED+RETRY count) and failed last 1h (log only). See docs if implemented.

## Error classification (PR8A)

- **Strict classification:** The Google Ads adapter classifies API responses so that validation errors do not trigger retries; only transient/rate-limit do.
- **400 (validation):** Treated as **FAILED** (no retry). The adapter returns `UploadResult[]` with `status: 'FAILED'` and provider error details (e.g. `INVALID_ARGUMENT`, message). Worker updates queue rows to `FAILED` and does not increment retry.
- **401 / 403 (auth):** Treated as **FAILED** (no retry). Adapter returns batch failure with `status: 'FAILED'`; worker sets rows to `FAILED`.
- **429 (rate limit):** Adapter throws `ProviderRateLimitError` → worker sets rows to **RETRY** (with `next_retry_at`). After max retries, worker sets **FAILED**.
- **500–599 (server error):** Adapter throws `ProviderTransientError` → worker sets **RETRY**. After max retries, worker sets **FAILED**.
- **Timeout / network:** Adapter throws `ProviderTransientError` → **RETRY**.
- **Partial failure (200 + partial_failure_error):** Per-item errors are classified in the adapter:
  - **FAILED:** e.g. `INVALID_ARGUMENT`, `INVALID_GCLID`, `UNPARSEABLE_GCLID`, `RESOURCE_NOT_FOUND` (conversion action).
  - **RETRY:** e.g. `RESOURCE_EXHAUSTED`, `UNAVAILABLE`, `DEADLINE_EXCEEDED`, `RATE_LIMIT`, `BACKEND_ERROR`.
- **Source of truth:** Postgres queue; no silent success. Worker only interprets `UploadResult.status`; classification is done in the adapter (`classifyGoogleAdsError` and per-item partial-failure rules).

## Upload proof fields (PR9)

- **Columns on `offline_conversion_queue`:** `uploaded_at` (timestamptz), `provider_request_id` (text), `provider_error_code` (text), `provider_error_category` (text). All nullable.
- **COMPLETED:** Worker sets `uploaded_at = now()`, `provider_request_id` from adapter result (e.g. from API response header `x-goog-request-id`), and clears `provider_error_code` and `provider_error_category`.
- **FAILED / RETRY:** Worker sets `provider_error_code` and `provider_error_category` from adapter result; `uploaded_at` remains null. Categories: `VALIDATION`, `AUTH`, `TRANSIENT`, `RATE_LIMIT`.
- **Adapter throw (system error):** Worker sets `provider_error_category = 'TRANSIENT'`, `provider_error_code = null`.
- **How to query:**  
  - Rows successfully sent: `WHERE uploaded_at IS NOT NULL` (and `status = 'COMPLETED'`).  
  - By error category: `WHERE provider_error_category = 'VALIDATION'` or `'TRANSIENT'`, etc.  
  - By site and upload time: `WHERE site_id = $1 AND uploaded_at >= $2` (index `idx_offline_conversion_queue_uploaded_at` on `(site_id, provider_key, uploaded_at)` WHERE `uploaded_at IS NOT NULL`).

## Attempt ledger (PR10)

- **Table:** `public.provider_upload_attempts` (append-only). **Access:** service_role only (RLS enabled, no policies). No secrets stored; multi-tenant by `site_id`.
- **Shape:** Each logical attempt = one **STARTED** row + one **FINISHED** row with the same `batch_id`. STARTED: `claimed_count`. FINISHED: `completed_count`, `failed_count`, `retry_count`, `duration_ms`, `provider_request_id`, `error_code`, `error_category`.
- **When:** Worker writes STARTED before calling `provider.uploadConversions`, then FINISHED after the call returns or throws (so every STARTED has a matching FINISHED, including on transient failure).
- **How to query (service_role / backend only):**
  - By site: `SELECT * FROM provider_upload_attempts WHERE site_id = $1 ORDER BY created_at DESC LIMIT 100;`
  - By batch: `SELECT * FROM provider_upload_attempts WHERE batch_id = $1 ORDER BY phase;` (STARTED then FINISHED).
  - Recent attempts with outcome: `SELECT * FROM provider_upload_attempts WHERE phase = 'FINISHED' AND site_id = $1 ORDER BY created_at DESC;`
  - Indexes: `(site_id, provider_key, created_at DESC)`, `(batch_id)`.

## Concurrency limits (PR11)

- **Redis semaphore** limits concurrent provider uploads per (site_id, provider_key) and optionally globally per provider. Prevents 429/5xx storms when many workers or crons run at once.
- **Keys:** `conc:{siteId}:{providerKey}` (per site+provider), `conc:global:{providerKey}` (optional global).
- **Env (defaults):**
  - `CONCURRENCY_PER_SITE_PROVIDER` = 2
  - `CONCURRENCY_GLOBAL_PER_PROVIDER` = 10 (set to 0 to disable global cap)
  - `SEMAPHORE_TTL_MS` = 120000 (2 min; expired tokens purged on acquire, crash-safe)
- **Flow:** Worker acquires site key, then global key (if enabled). If either fails → do **not** call provider; mark group **RETRY** with `next_retry_at = now + 30s + jitter(0..10s)`, `last_error = 'CONCURRENCY_LIMIT: Semaphore full'`, `provider_error_code = 'CONCURRENCY_LIMIT'`, `provider_error_category = 'TRANSIENT'`; write ledger STARTED+FINISHED; `record_provider_outcome(transient=true)`; then continue. On success, after upload (and in all cases) **finally** release both tokens.
- **Fail-open:** If Redis is unavailable, `acquireSemaphore` returns null → same CONCURRENCY_LIMIT path (no upload).
- **Smoke:** Set `CONCURRENCY_PER_SITE_PROVIDER=1`, trigger worker twice in parallel; second run should get RETRY with CONCURRENCY_LIMIT and no provider call.

## PR7 (Performance + determinism)

- **list_offline_conversion_groups:** Returns `queued_count`, `min_next_retry_at`, `min_created_at` per group; worker uses backlog-weighted fair share (see Claim above).
- **Recovery RPC:** `recover_stuck_offline_conversion_jobs(p_min_age_minutes)` selects PROCESSING rows where `claimed_at < now() - interval` (or `claimed_at IS NULL AND updated_at < now() - interval`); moves to **RETRY**, `next_retry_at = NULL` (state semantics: recovery = retry; eligible immediately). Auth: `auth.role() IS DISTINCT FROM 'service_role'` → deny (service_role only).
- **Indexes:** `idx_offline_conversion_queue_eligible_scan` on (site_id, provider_key, status, next_retry_at) WHERE status IN ('QUEUED','RETRY'); `idx_offline_conversion_queue_processing_claimed_at` on (claimed_at) WHERE status = 'PROCESSING'.
