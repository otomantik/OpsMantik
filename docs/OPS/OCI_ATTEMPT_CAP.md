# OCI Attempt Cap Runbook

**Purpose:** Mark queue rows that have been attempted too many times (export claim count >= MAX_ATTEMPTS) as FAILED so they do not retry indefinitely. This enforces the terminal-state guarantee.

## Schedule

- **Cron:** `GET /api/cron/oci/attempt-cap` every 15 minutes (Vercel Cron).
- **Auth:** CRON_SECRET (Bearer) or x-vercel-cron.

## RPC

- **Name:** `oci_attempt_cap(p_max_attempts int DEFAULT 5, p_min_age_minutes int DEFAULT 0)`
- **Behavior:** Updates rows where:
  - `status IN ('QUEUED', 'RETRY', 'PROCESSING')`
  - `attempt_count >= p_max_attempts`
  - If `p_min_age_minutes > 0`: `updated_at < now() - p_min_age_minutes`
- **Set:** `status = 'FAILED'`, `provider_error_code = 'MAX_ATTEMPTS'`, `provider_error_category = 'PERMANENT'`, `last_error = 'MAX_ATTEMPTS_EXCEEDED'`, `updated_at = now()`.
- **Returns:** Number of rows updated.

## attempt_count semantics

- **Incremented only on export claim** (when script calls GET export with `markAsExported=true` and rows move QUEUED/RETRY -> PROCESSING).
- Recover (PROCESSING -> RETRY) does **not** increment attempt_count.
- ack-failed does **not** increment attempt_count.
- So attempt_count = "how many times this row was claimed for processing".

## Verification

1. **Query FAILED rows with MAX_ATTEMPTS:**
   ```sql
   SELECT id, site_id, status, attempt_count, provider_error_code, last_error, updated_at
   FROM offline_conversion_queue
   WHERE provider_error_code = 'MAX_ATTEMPTS'
   ORDER BY updated_at DESC
   LIMIT 20;
   ```
2. **Manual trigger (same auth as cron):**
   ```bash
   curl -X GET "https://<host>/api/cron/oci/attempt-cap?max_attempts=5&min_age_minutes=0" \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
   Response: `{ "ok": true, "affected": N }`.

## Terminal behavior

Rows marked FAILED by attempt-cap are **terminal**. They are not moved by recover-processing. Operators can use OCI Control dashboard to "Retry" (move back to QUEUED) if they fix the underlying issue.
