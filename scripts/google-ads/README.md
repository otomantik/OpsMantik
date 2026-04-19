# Deprecated: Per-Site OCI Script Snapshots

This directory previously held per-site copies of the Google Ads OCI script with hardcoded
API keys and site identifiers. Those snapshots leaked credentials into git history and
caused drift from the canonical script.

**Canonical source (single source of truth):**

- `scripts/google-ads-oci/GoogleAdsScript.js`

**Deployment:**

- Copy the canonical script into the Google Ads "Bulk actions → Scripts" editor for the target account.
- Inject per-site configuration via Google Ads Script Parameters (or the `OPSMANTIK_*` script constants at the top of the file). **Never** commit a per-site copy back to this repository.
- Legacy endpoints `/api/oci/export` and `/api/oci/export-batch` are retired. The active contract is `google-ads-export → ack/ack-failed → verify`.

Any API keys previously committed under `eslamed-oci-script.js`, `muratcan-aku-oci-script.js`, and `gecgenotokurtarici-oci-script.js` **must** be treated as leaked and rotated in the corresponding site's OCI credential record.
