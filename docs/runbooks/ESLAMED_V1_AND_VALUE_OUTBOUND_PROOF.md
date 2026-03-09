# Eslamed V1 And Value Outbound Proof

## Purpose

This proof locks the expected OCI contract for `Eslamed` after the V1 Nabiz and valuation sprint.

## Canonical Contract

- `V1_PAGEVIEW` is part of OCI.
- Tracker page views must reach `POST /api/track/pv`.
- Redis storage for V1 uses the canonical site UUID key; export may also drain a legacy `public_id` queue during migration.
- V1 sampling happens only in `scripts/google-ads-oci/GoogleAdsScript.js`.
- `V1_PAGEVIEW` uses a 1 minor-unit visibility value.
- `min_conversion_value_cents` remains the V5 fallback floor and does not flatten V2/V3/V4.

## Eslamed Value Expectations

Assumptions:

- `default_aov = 1000 TRY`
- `intent_weights = { pending: 0.02, qualified: 0.2, proposal: 0.3, sealed: 1.0 }`
- `min_conversion_value_cents = 100000`
- signal delay window used here: `1 day`, so current decay profile is `0.5`

Expected outbound values:

| Gear | Google conversion name | Math | Expected value |
|------|------------------------|------|----------------|
| V1 | `OpsMantik_V1_Nabiz` | 1 minor unit visibility value | `0.01 TRY` |
| V2 | `OpsMantik_V2_Ilk_Temas` | `1000 * 0.02 * 0.5` | `10 TRY` |
| V3 | `OpsMantik_V3_Nitelikli_Gorusme` | `1000 * 0.2 * 0.5` | `100 TRY` |
| V4 | `OpsMantik_V4_Sicak_Teklif` | `1000 * 0.3 * 0.5` | `150 TRY` |
| V5 | `OpsMantik_V5_DEMIR_MUHUR` | actual sale amount, else site fallback | `sale amount` or `1000 TRY fallback` |

## Preview Checklist

1. Call `GET /api/oci/google-ads-export?siteId=<site>&markAsExported=false`.
2. Confirm V1 rows are present when tracker page views with click IDs exist.
3. Confirm V2/V3/V4 are not all `1000`.
4. Confirm only the script logs `DETERMINISTIC_SKIP` for V1 sampling.
5. Confirm V5 rows still carry the true sale amount when available.
