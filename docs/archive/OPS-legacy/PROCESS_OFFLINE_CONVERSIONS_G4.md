# PR-G4: Process Offline Conversions (Worker Loop)

- **Route:** `POST /api/cron/process-offline-conversions`
- **Auth:** `requireCronAuth` (x-vercel-cron or Bearer CRON_SECRET)
- **Query:** `provider_key?` (optional), `limit` (default 50, max 500)
- **Flow:** Claim jobs via `claim_offline_conversion_jobs_v2` (status IN QUEUED/RETRY, next_retry_at <= now()), group by (site_id, provider_key), decrypt credentials (vault), call provider `uploadConversions`, update rows: COMPLETED / RETRY (backoff) / FAILED.
- **Backoff:** `min(5m * 2^retry_count, 24h)`.
- **Depends on:** G1 (vault + provider_credentials for decrypt), G2 (queue v2 columns), G3 (google_ads adapter). If vault or provider_credentials table is missing, jobs are marked RETRY with "No credentials" or "Vault not configured".

## Smoke

```bash
curl -X POST "http://localhost:3000/api/cron/process-offline-conversions?limit=10" \
  -H "x-vercel-cron: 1"
# or
curl -X POST "http://localhost:3000/api/cron/process-offline-conversions" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```
