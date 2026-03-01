# OCI Google Ads Script Deployment Runbook

**Purpose:** Deploy and configure the Eslamed Quantum OCI Script for Google Ads Offline Conversion Import. The script reads from the OpsMantik API and uploads conversions to Google Ads.

## Prerequisites

- Google Ads account with Ads API access
- OpsMantik site configured with `oci_sync_method = 'script'`
- API key and site ID from OpsMantik console

## Script Properties (Required)

Do **not** hardcode secrets in the script. Use **Project Settings > Script Properties** in Google Apps Script:

| Key | Description |
|-----|-------------|
| `OPSMANTIK_SITE_ID` | Site public ID or UUID |
| `OPSMANTIK_API_KEY` | OCI API key from OpsMantik console |
| `OPSMANTIK_BASE_URL` | (Optional) API base URL, default: https://console.opsmantik.com |

### How to Set

1. Open the Google Ads Script in Apps Script editor
2. Go to **Project Settings** (gear icon)
3. Under **Script Properties**, add each key-value pair
4. Values are not shown in code editor and are not stored in version control

## Security

- Never commit API keys or site IDs to the repository
- Script Properties are scoped to the script and only visible to users with edit access

## Local Testing

For local mock runs (`node scripts/google-ads-oci/GoogleAdsScript.js`):

- Set environment variables: `OPSMANTIK_SITE_ID`, `OPSMANTIK_API_KEY`
- Or the script uses mock fallbacks when run as main module

## Deterministic Features

- **V1 Sampling:** 10% deterministic hash-based sampling (DJB2)
- **Time Validation:** Strict `YYYY-MM-DD HH:mm:ss+ZZ:ZZ` format
- **Upload Failure Invariant:** On `upload.apply()` exception, script returns `uploadFailed: true` and does **not** call ACK
- **DETERMINISTIC_SKIP Audit:** Skipped V1 items are sent as `skippedIds` to ACK endpoint; backend marks them COMPLETED with `provider_error_category = 'DETERMINISTIC_SKIP'`

## Verification

1. Run the script in Google Ads (Test or Production)
2. Check OCI Control dashboard for COMPLETED / FAILED status
3. DETERMINISTIC_SKIP rows should show `provider_error_category = 'DETERMINISTIC_SKIP'` in OCI Control
