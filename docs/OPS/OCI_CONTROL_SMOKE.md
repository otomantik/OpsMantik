# OCI Control Smoke Verification

## 1. Stuck PROCESSING -> RETRY (recover)

- **Setup:** Leave a row in PROCESSING with `claimed_at` or `updated_at` older than 15 minutes (or create one manually in DB).
- **Action:** Call recover-processing (cron or manual):
  ```bash
  curl -X GET "https://<host>/api/cron/providers/recover-processing?min_age_minutes=15" \
    -H "Authorization: Bearer $CRON_SECRET"
  ```
- **Verify:** Row status is RETRY. Optionally run export with `markAsExported=true` again; row can be claimed (attempt_count increments).

## 2. Attempt cap -> FAILED

- **Setup:** Set a row to `attempt_count = 5` (or >= MAX_ATTEMPTS), `status = 'RETRY'` or `'QUEUED'` or `'PROCESSING'`.
- **Action:** Call attempt-cap:
  ```bash
  curl -X GET "https://<host>/api/cron/oci/attempt-cap?max_attempts=5&min_age_minutes=0" \
    -H "Authorization: Bearer $CRON_SECRET"
  ```
- **Verify:** Row is FAILED with `provider_error_code = 'MAX_ATTEMPTS'`, `provider_error_category = 'PERMANENT'`, `last_error = 'MAX_ATTEMPTS_EXCEEDED'`.

## 3. Export preview (no mutation)

- **Action:** `GET /api/oci/google-ads-export?siteId=<id>&markAsExported=false` with valid session or x-api-key.
- **Verify:** Response 200, body has `{ siteId, items, counts, warnings }`. No queue row should change status (rows remain QUEUED/RETRY).

## 4. OCI Control UI

- Log in as site owner or admin. Open `/dashboard/site/<siteId>/oci-control`.
- **Verify:** Stats load (QUEUED, RETRY, PROCESSING, COMPLETED, FAILED counts). Table loads. Select a FAILED row, click Retry; verify status becomes QUEUED and stats update. Use "Mark FAILED" on a PROCESSING row (or use bulk); verify FAILED and last_error set.

## 5. Script upload exception -> ack-failed

- In script test mode (or with a mock), make `upload.apply()` throw.
- **Verify:** `sendAckFailed` is called with the appended row IDs, `errorCode = 'UPLOAD_EXCEPTION'`, `errorCategory = 'TRANSIENT'`. Rows move to FAILED in DB.

## 6. Stats correctness

- Call `GET /api/oci/queue-stats?siteId=<id>` with valid session.
- Compare `totals` with a direct DB query:
  ```sql
  SELECT status, count(*) FROM offline_conversion_queue WHERE site_id = '<uuid>' GROUP BY status;
  ```
- Counts should match (within race window).
