# OCI Partial Failure Architecture — Strict Row-Level Error Handling

## Executive Summary

| Path | Partial Failure Handling | Status |
|------|--------------------------|--------|
| **API** (`oci_sync_method=api`) | ✅ Full row-level handling via Google Ads API | Use `process-offline-conversions` |
| **Script** (`oci_sync_method=script`) | ❌ AdsApp bulk upload returns void — no per-row errors | Migrate to API for strict validation |

---

## 1. API Path (Recommended for Strict Validation)

**Flow:** `process-offline-conversions` cron → `GoogleAdsAdapter` → Google Ads REST API `uploadClickConversions`

- **200 OK** alone is NOT trusted. Response MUST be parsed for `partial_failure_error`.
- **Row-level mapping:** `partial_failure_error.details[].errors[].location.field_path_elements[0].index` → request conversions array index → `jobIdByIndex[index]` → queue row ID.
- **Success:** Rows not in `failedIndices` → `COMPLETED`, `uploaded_at` set.
- **Failure:** Rows in `failedIndices` → `FAILED` or `RETRY` based on `isRetryablePartialError(message)`.
- **Error persistence:** `last_error`, `provider_error_code`, `provider_error_category` saved per row.

### Fatal Errors (Never Retry)

- `ConversionPrecedesClick`, `TooRecentConversion`
- `INVALID_GCLID`, `UNPARSEABLE_GCLID`
- `INVALID_FIELD_VALUES_IN_DATE_TIME`, `DateError`
- `RESOURCE_NOT_FOUND`, `CONVERSION_NOT_FOUND`, `INVALID_ARGUMENT`

### Transient Errors (Retry Allowed)

- `RESOURCE_EXHAUSTED`, `UNAVAILABLE`, `DEADLINE_EXCEEDED`
- `RATE_LIMIT`, `BACKEND_ERROR`, `TEMPORARILY`

---

## 2. Script Path (Limitation)

**Flow:** Google Ads Script → `AdsApp.bulkUploads().newCsvUpload()` → `upload.apply()`

- **Problem:** `apply()` returns **void**. No per-row success/failure info.
- **Consequence:** If Google rejects rows (e.g. invalid conversion time), errors appear only in Google Ads UI (Tools > Bulk Actions > Uploads). Our system marks all appended rows as `COMPLETED`.
- **Fix:** Use correct format (`yyyy-mm-dd HH:mm:ss+HH:mm`) to avoid validation errors. If errors appear in UI: run `npm run db:enqueue:fix` to re-queue and correct data.

### Migration to API Path

To get strict row-level handling for Script-mode sites:

1. Set `oci_sync_method = 'api'` for the site.
2. Add `provider_credentials` (OAuth: customer_id, developer_token, client_id, client_secret, refresh_token, conversion_action_resource_name).
3. Remove or disable the Google Ads Script; `process-offline-conversions` cron will process the queue.

---

## 3. Database Schema

| Column | Usage |
|--------|-------|
| `last_error` | Raw error message (max 1000 chars) |
| `provider_error_code` | Extracted code (e.g. INVALID_GCLID, DateError_INVALID_FIELD_VALUES) |
| `provider_error_category` | VALIDATION, AUTH, TRANSIENT, RATE_LIMIT |
| `uploaded_at` | Set only when row is actually COMPLETED (API path) |

---

## 4. Deterministic Rules (Audit Checklist)

- [x] Do NOT rely solely on 200 OK; parse `partial_failure_error`.
- [x] Map `field_path_elements[0].index` to queue row ID via `jobIdByIndex`.
- [x] Row N succeeds → `COMPLETED`, `uploaded_at` set.
- [x] Row N fails → `FAILED` or `RETRY`, `last_error` + `provider_error_code` saved.
- [x] Fatal errors → `FAILED`; transient → `RETRY`.
- [x] `attempt_count` cap (≥8) → `FATAL`; `VALIDATION`/`AUTH` category → no requeue.
