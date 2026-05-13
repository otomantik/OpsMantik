# Google Ads OCI Script (OpsMantik Exit Valve)

## Canonical production script

**`GoogleAdsScriptUniversal.js`** is the **only** canonical production Google Ads OCI fleet script in this repository. Paste it into the Google Ads Script editor with entry point `main` (Chrome V8 ON).

- **Legacy site forks** (`GoogleAdsScriptKocOtoKurtarma.js`, `TecrubeliBakici`, `MuratcanAku`, `GoogleAdsScript.js`, `GoogleAdsScriptProduction.js`) were **removed** from this tree; frozen **string snapshots** for CI live under `tests/fixtures/google-ads-oci/` and are listed in `fleet-quarantine.json` / `FLEET_QUARANTINE.md` — **not** paste targets.
- **New site onboarding** must use **Universal** + **Script Properties** (`OPSMANTIK_SITE_ID`, `OPSMANTIK_API_KEY`, optional `OPSMANTIK_BASE_URL`, `OPSMANTIK_EXPORT_LIMIT`, `OPSMANTIK_RUN_MODE`, etc.) and/or `scripts/google-ads-oci/sites/<slug>.json` with `npm run build:google-ads-script -- --site=<slug>`.
- **New `GoogleAdsScript*.js` forks** require **explicit exception approval** and a `fleet-quarantine.json` row before merge (CI enforces a single non-quarantined script: Universal).

## SSOT conversion action names (Google Ads)

Create matching **offline conversion** actions in Google Ads with these **exact** strings (from `lib/oci/conversion-names.ts`):

- `OpsMantik_Contacted`
- `OpsMantik_Offered`
- `OpsMantik_Won`
- `OpsMantik_Junk_Exclusion`

## Core invariants (fleet CI)

- **`upload.apply()` success is not Google provider confirmation.** Success `/api/oci/ack` uses **`pendingConfirmation: true`** and **`providerConfirmationMode: 'bulk_upload_async_unconfirmed'`** (dispatch-pending / UPLOADED semantics). Failures belong on **`/api/oci/ack-failed`**, not mixed into success ACK rows.
- **Click IDs:** priority **gclid > wbraid > gbraid**; exactly **one** of the Bulk Upload columns `Google Click ID` / `WBRAID` / `GBRAID` is populated per row.
- **Hashed phone:** courier-only from server JSON (`extractHashedPhone`); **never** hash raw phone in script (`Utilities.computeDigest` / `DigestAlgorithm` banned in fleet truth tests).

## Conversion time policy (zero tolerance)

Script payload time must represent the first intent creation timestamp from backend SSOT.

- Contract: `docs/OPS/OCI_CONVERSION_TIME_ZERO_TOLERANCE.md`
- Script/runtime must not replace conversion time with upload-time `now()`.

## Fleet CI, quarantine, ACK truth

- CI: `tests/unit/oci-script-fleet-truth-contract.test.ts` (every `GoogleAdsScript*.js` under `scripts/google-ads-oci/` is either listed in `fleet-quarantine.json` with a repo path or must match Universal-only rules; quarantine fixtures under `tests/fixtures/` carry provenance headers).
- Quarantine: `scripts/google-ads-oci/fleet-quarantine.json` — each `productionSafe: false` row carries `replacementCanonical`, `sunsetDate`, `replacementPlan`, and `lastKnownUse`.

`scripts/google-ads/*.js` and `scripts/google-ads-oci/deploy/*.js` are **deploy snapshots**, not canonical sources.

## Build per-site paste bundle (optional)

```bash
npm run build:google-ads-script -- --site=muratcan-aku
```

Emits `scripts/google-ads-oci/dist/google-ads-script-<slug>.js` from **`GoogleAdsScriptUniversal.js`** (injects `SITE_ID`, `BASE_URL`, `EXPORT_LIMIT`, `RUN_MODE`; **API key stays empty** — set in Script Properties).

## OCI credentials

Prefer **Script Properties** over inline secrets.

```bash
npm run oci:credentials Eslamed              # print values
npm run oci:credentials Eslamed -- --write   # update deploy snapshot (if applicable)
node scripts/get-oci-credentials.mjs Muratcan
```

## What it does

1. Fetches ready conversions: `GET .../api/oci/google-ads-export?siteId=...&markAsExported=true` (with signed / drain headers as implemented in Universal).
2. Uploads via Google Ads **offline conversions** bulk CSV (`upload.apply()` once per run).
3. ACK: `POST /api/oci/ack` with dispatch-pending flags; validation / upload errors use `POST /api/oci/ack-failed`.

## Endpoints (single rule)

- Live export: `/api/oci/google-ads-export`
- ACK: `/api/oci/ack`
- NACK: `/api/oci/ack-failed`
- Legacy `/api/oci/export` and `/api/oci/export-batch` are retired.

## Eslamed / legacy Quantum snapshots

Historical references to `Eslamed-OCI-Quantum.js` / deploy folder snapshots may still appear in older runbooks; **new work** should standardize on **Universal**. `deploy/Muratcan-OCI-Quantum.js` was previously marked deprecated — prefer Universal + properties.
