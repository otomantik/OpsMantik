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

**Production value path** — vocabulary: **`lead_score`** (quality), **`stage_base_major`** / `OPTIMIZATION_STAGE_BASES` (economics), **`truth_closure_score`** (audit only; never export value). See [CLOSED_SYSTEM_SCORE_CONTRACT.md](./CLOSED_SYSTEM_SCORE_CONTRACT.md).

`resolveOptimizationValue` yields `optimization_value = stage_base` with `systemScore` held at **0** on the Google-facing path — **`lead_score` is not a production multiplier here** (intentional).

Stage bases (`OPTIMIZATION_STAGE_BASES` in `lib/oci/optimization-contract.ts`):

- `OpsMantik_Junk_Exclusion` → 0.1 major units
- `OpsMantik_Contacted` → 10
- `OpsMantik_Offered` → 50
- `OpsMantik_Won` → 100 (**stage economic** 100 majors, not operator HOT **lead_score** 100)

`resolveQualityFactor` exists for legacy/utility callers; the snapshot fed into marketing-signal economics uses **quality_factor = 1.0** and **optimization_value = stage_base** from `buildOptimizationSnapshot` / `resolveOptimizationValue`.

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
| **`offline_conversion_queue` (journal)** | **Google Ads offline conversion upload** — the only rows serialized by `GET /api/oci/google-ads-export` and uploaded by the script. |
| **`marketing_signals`** | Stage/audit/hash/recovery plane; **not** read by `google-ads-export`. Economics may mirror here for lineage; upload authority is the journal. |

OCI export does **not** read projection rows for batch export; **only** the journal is the script upload row source. ACK primarily finalizes journal rows; legacy `signal_*` handling may still exist for older ack payloads.

## Red lines

- Do not reintroduce AOV/decay/gear-weight based export math.
- Do not merge `marketing_signals` into the Google script GET batch (see [EXPORT_CLOSURE.md](./EXPORT_CLOSURE.md)).
- Do not let `actual_revenue` leak back into Google value bidding math.
