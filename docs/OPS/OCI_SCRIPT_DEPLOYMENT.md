# OCI Google Ads Script Deployment Runbook

**Purpose:** Deploy and configure the **Universal** OpsMantik OCI Google Ads Script for Offline Conversion Import. Canonical source: `scripts/google-ads-oci/GoogleAdsScriptUniversal.js`. The script reads from the OpsMantik API and uploads conversions to Google Ads.

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

For local mock runs (`node` against the repo file — **not** supported for Universal motor without Google Ads mocks):

- Prefer validating fleet contracts via `npm run test:unit` and `tests/unit/oci-script-fleet-truth-contract.test.ts`.
- Legacy `GoogleAdsScript.js` (historical; **removed** from repo) was **quarantined**; do not treat any legacy fork as the paste target — use **Universal**.

## Deterministic Features

- **V1 Ingress Contract:** Tracker page views post to `/api/track/pv`; backend exports every eligible V1 row and historical scripts implemented sampling in-client. **Universal** does not reimplement DJB2 sampling; server export + queue journal own eligibility.
- **V1 Sampling (historical):** Documented previously on quarantined `GoogleAdsScript.js` — not replicated in `GoogleAdsScriptUniversal.js`.
- **Time validation:** Universal `isValidTime` / `normalizeTime` accept Ads-style timestamps with optional colon in numeric timezone offset.
- **Upload failure invariant:** On `upload.apply()` exception, Universal calls **`/api/oci/ack-failed`** for attempted queue ids with **`UPLOAD_EXCEPTION` / `TRANSIENT`**, then **returns** — it does **not** send dispatch-pending **`/api/oci/ack`** for those rows.
- **Skipped rows:** Optional `skippedIds` may be forwarded on success ACK when applicable; deterministic skip semantics remain backend-owned.

## Sites migrated to API (Worker)

When a site is switched to **Worker (API)** — `oci_sync_method = 'api'` — it must be **removed from the Apps Script** so only the worker processes its queue (no dual-channel). See **SOP: Apps Script Quarantine (Sunset Maneuver)** in `docs/runbooks/OCI_GOOGLE_ADS_SCRIPT_CONTROL.md` (Phase 3): remove the site ID from Script Properties (`OPSMANTIK_SITE_ID` or equivalent).

## Verification

1. Run the script in Google Ads (Test or Production)
2. Check OCI Control dashboard for COMPLETED / FAILED status
3. DETERMINISTIC_SKIP rows should show `provider_error_category = 'DETERMINISTIC_SKIP'` in OCI Control
4. If V1 is absent, verify tracker traffic reaches `/api/track/pv` before investigating the export route

## Rotate-All OCI API Key Rollout

When `oci_api_key` values are rotated for all sites, every script must be updated before normal export resumes.

### Phase 1 — DB migration

Apply migrations in order:

1. `20260501184500_oci_api_key_auto_provision.sql`
2. `20260501184600_oci_api_key_rotate_all_sites.sql`

Effects:
- New sites get `oci_api_key` automatically on insert (DB trigger).
- Existing site keys are regenerated (old keys become invalid).

### Phase 2 — key extraction and secure delivery

Generate masked rollout report:

```sql
select
  id,
  name,
  public_id,
  left(oci_api_key, 8) || '...' as key_mask
from public.sites
order by name;
```

Full keys must be shared only over approved secure channel (never Git, never chat logs, never plain runbooks).

### Phase 3 — script update checklist

For each Google Ads Script:

1. Update `OPSMANTIK_SITE_ID`.
2. Update `OPSMANTIK_API_KEY` to new value.
3. Keep `OPSMANTIK_BASE_URL=https://console.opsmantik.com` unless environment requires otherwise.
4. Run one manual script execution and verify no `INVALID_CREDENTIALS` in logs.

### Phase 4 — canary then full rollout

1. Select 2 canary sites and run script once.
2. Verify `/api/oci/v2/verify` handshake success and export+ack success.
3. If clean, continue with remaining sites.

### Rollback note

Rotate-all is not reversible. If a key is lost/leaked, rotate again and re-distribute script credentials.
