# OCI Value Engines and SSOT (Single Source of Truth)

This document describes how conversion values are produced after the universal value cutover. It complements [FUNNEL_CONTRACT.md](./FUNNEL_CONTRACT.md) with an operational, OCI-specific view.

## Current SSOT

| Path | Entry point | Value source | Output |
|------|-------------|--------------|--------|
| **Stage signals** | panel stage route, seal route, outbox fallback | `buildOptimizationSnapshot(stage, systemScore)` | `marketing_signals.optimization_value` + `expected_value_cents` |
| **Sale queue** | `enqueueSealConversion` | `buildOptimizationSnapshot('satis', systemScore)` | `offline_conversion_queue.optimization_value` + `value_cents` mirror |
| **Export** | `/api/oci/google-ads-export` | Prefers `optimization_value`, falls back to stored cents only for legacy rows | JSON for Google Ads Script |

The universal formula is:

`optimization_value = stage_base * quality_factor`

Where:

- `junk = 0.1`
- `gorusuldu = 10`
- `teklif = 50`
- `satis = 100`
- `quality_factor = 0.6 + 0.6 * (system_score / 100)`

`actual_revenue` is internal only and no longer drives Google export value.

## Site configuration

- `sites.oci_config` is no longer authoritative for value math.
- `parseExportConfig()` currently returns the universal default export contract.
- Conversion naming is fixed to `OpsMantik_Gorusuldu`, `OpsMantik_Teklif`, `OpsMantik_Satis`, `OpsMantik_Cop_Exclusion`.

## `call_funnel_projection` vs Google OCI export

| Artifact | Purpose |
|----------|---------|
| **`call_funnel_projection`** | Analytics, metrics API, ACK for `proj_*` ids, phone lookup — maintained by `funnel-projection` cron. |
| **`offline_conversion_queue` + `marketing_signals`** | **Google Ads offline conversion upload** via `google-ads-export` + script ACK. |

OCI export does **not** read projection rows for batch export; queue + signals are the upload SSOT.

## Red lines

- Do not reintroduce AOV/decay/gear-weight based export math.
- Do not export non-canonical signal stages from `marketing_signals`.
- Do not let `actual_revenue` leak back into Google value bidding math.
