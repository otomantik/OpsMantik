# OCI Value Engines and SSOT (Single Source of Truth)

This document describes how **V2–V5 conversion values** are produced and which database columns feed each path. It complements [FUNNEL_CONTRACT.md](./FUNNEL_CONTRACT.md) with an operational, OCI-specific view.

## Three value engines (V2–V4)

| Engine | Entry point | Weight / AOV source | Output |
|--------|-------------|----------------------|--------|
| **Mizan outbox** | `evaluateAndRouteSignal` → `insertMarketingSignal` | `getSiteValueConfig` → `sites.default_aov` + **derived** `intentWeights` from `sites.oci_config` (SiteExportConfig `gear_weights`) when present | `marketing_signals` rows |
| **Seal LCV** | `/api/calls/[id]/seal` (lead_score 10–99) | `parseExportConfig(sites.oci_config)` → `gear_weights`, `intelligence`; `sites.default_aov` | `marketing_signals` rows (dedup vs outbox) |
| **Export** | `/api/oci/google-ads-export` | Reads **precomputed** `value_cents` / `expected_value_cents` from DB; applies gates (`validateExportRow`) | JSON for Google Ads Script |

V5 (seal with sale) uses **`offline_conversion_queue`**: `enqueueSealConversion` → `computeConversionValue(saleAmount)` → funnel-kernel `computeSealedValue`. No star-based gating.

## Site configuration: one JSON column

- **`sites.oci_config`** — Zod `SiteExportConfig` (`parseExportConfig` in `lib/oci/site-export-config.ts`). Holds `gear_weights` (V2/V3/V4), decay, conversion action names, enhanced conversions, etc.
- **`sites.intent_weights`** — Legacy JSONB; **prefer** `oci_config.gear_weights`. `getSiteValueConfig` derives `IntentWeights` from `gear_weights` when `oci_config` is present so Mizan matches export math.

## `call_funnel_projection` vs Google OCI export

| Artifact | Purpose |
|----------|---------|
| **`call_funnel_projection`** | Analytics, metrics API, ACK for `proj_*` ids, phone lookup — maintained by `funnel-projection` cron. |
| **`offline_conversion_queue` + `marketing_signals`** | **Google Ads offline conversion upload** via `google-ads-export` + script ACK. |

OCI export does **not** read projection rows for batch export; queue + signals are the upload SSOT.

## Red lines

- Do not add a third parallel weight column without updating this doc and `getSiteValueConfig` / `parseExportConfig`.
- Seal LCV must pass `gearWeights` and LCV `config` from `parseExportConfig` so dashboard and Google see the same ratios.
