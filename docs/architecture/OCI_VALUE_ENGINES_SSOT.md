---
status: active
---

# OCI Value Engines and SSOT (Single Source of Truth)

This document describes how conversion values are produced in current runtime SSOT. It complements [FUNNEL_CONTRACT.md](./FUNNEL_CONTRACT.md) with an operational, OCI-specific view.

## Current SSOT

| Path | Entry point | Value source | Output |
|------|-------------|--------------|--------|
| **Stage signals** | panel stage route, seal route, outbox fallback | `buildOptimizationSnapshot(stage, systemScore)` | `marketing_signals.optimization_value` + `expected_value_cents` |
| **Sale queue** | `enqueueSealConversion` | `buildOptimizationSnapshot('satis', systemScore)` | `offline_conversion_queue.optimization_value` + `value_cents` mirror |
| **Export** | `/api/oci/google-ads-export` | Prefers `optimization_value`, falls back to stored cents only for legacy rows | JSON for Google Ads Script |

The universal formula is:

`optimization_value = stage_base * quality_factor`

Where:

- `OpsMantik_Junk_Exclusion = 0.1`
- `OpsMantik_Contacted = 10`
- `OpsMantik_Offered = 50`
- `OpsMantik_Won = 100`
- `quality_factor = 0.6 + 0.6 * (system_score / 100)`

`actual_revenue` is preserved as provenance in snapshots/rows. Won economics keeps explicit fallback provenance via policy fields (`value_source`, `value_policy_version`, `value_policy_reason`, `value_fallback_used`) and must remain aligned with runtime guards.

## Site configuration

- `sites.oci_config` is no longer authoritative for value math.
- `parseExportConfig()` currently returns the universal default export contract.
- Conversion naming is fixed to canonical English actions:
  - `OpsMantik_Contacted`
  - `OpsMantik_Offered`
  - `OpsMantik_Won`
  - `OpsMantik_Junk_Exclusion`

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
