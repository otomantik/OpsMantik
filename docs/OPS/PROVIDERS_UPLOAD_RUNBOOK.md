# Providers upload runbook (Google Ads OCI)

- **Worker:** `POST /api/cron/process-offline-conversions` (claim → decrypt creds → upload → update status). Vercel: every 10 min (`vercel.json`).
- **Recovery:** `POST /api/cron/providers/recover-processing` (requeue stuck PROCESSING jobs). Vercel: every 30 min (`vercel.json`).
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
