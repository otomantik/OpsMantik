# OCI Google Ads script fleet — quarantine manifest

Human-readable mirror of `fleet-quarantine.json` (version **2**). **Canonical production script:** `GoogleAdsScriptUniversal.js` (not listed as quarantined).

## Active quarantine rows (`productionSafe: false`)

Paths in JSON `file` are **repo-relative** (often under `tests/fixtures/` — **not** paste targets).

| File | Owner | productionSafe | sunsetDate | replacementCanonical | Reason (short) |
|------|-------|----------------|------------|------------------------|----------------|
| `tests/fixtures/google-ads-oci/PR9H7B_GOOGLE_ADS_SCRIPT_PRODUCTION_SNAPSHOT.js` | OpsMantik Platform | false | 2026-11-30 | GoogleAdsScriptUniversal.js | Frozen PR-9H.7B canary / GCLID-first template strings (ex-`GoogleAdsScriptProduction.js`) |
| `tests/fixtures/google-ads-oci/PR9H4C_MURATCAN_MARK_DEFAULT_SNAPSHOT.js` | OpsMantik Platform | false | 2026-11-30 | GoogleAdsScriptUniversal.js | Frozen export mark-default line (ex-`GoogleAdsScriptMuratcanAku.js`) |

## Removed from repository (git history only)

These **Apps Script** forks were deleted from `scripts/google-ads-oci/` after Universal became canonical. Do not restore without platform review.

- `GoogleAdsScript.js` — legacy sample
- `GoogleAdsScriptKocOtoKurtarma.js` — historical PR-9K Koç fork
- `GoogleAdsScriptTecrubeliBakici.js` — site fork ACK drift
- (Production / Muratcan string parity lives in **fixtures** above.)

New site onboarding: **Universal** + Script Properties (and optional `sites/*.json` + `npm run build:google-ads-script`). New `GoogleAdsScript*.js` forks require **explicit exception approval** and a quarantine row before merge.
