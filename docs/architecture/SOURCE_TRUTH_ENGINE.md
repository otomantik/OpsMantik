# Source Truth Engine (Conversion Truth OS — Phase 0)

## Philosophy

**Business revenue !== Google training value.** The Source Truth Engine classifies session traffic with a deterministic evidence pipeline and full investigation ledger.

## Modules

| Path | Role |
|------|------|
| `lib/attribution/truth-engine-types.ts` | Ledger types |
| `lib/attribution/truth-engine-core.ts` | Pure `classifyTraffic()` |
| `lib/attribution/shadow-evaluator.ts` | Legacy + v2 parallel |
| `lib/attribution/session-shadow.ts` | Ingest shadow write |
| `lib/attribution/temporal-context.ts` | 24h previous session for dark return |

## Rule precedence

1. `srsltid` → organic_shopping (never paid)
2. Fraud veto (click-id + bot UA / fraud referrer)
3. Valid Google click-id → paid_search
4. UTM conflicts → click-id wins
5. Maps / AI / UA whisper / dark return / referrer / fallback

## Shadow mode

- Flag: `SOURCE_TRUTH_SHADOW_ENABLED=true`
- Writes: `sessions.traffic_v2_ledger` JSONB only
- Does **not** change `attribution_source`, `traffic_source`, or `traffic_medium`

## GA4 vs OpsMantik (local_maps)

GA4 often groups Maps under Organic Search; OpsMantik uses **local_maps** for operator clarity.

## Phase 1 (gated)

- `lib/attribution/identity-graph.ts` — cross-device stitch
- `lib/attribution/shapley-math.ts` — fractional training value shadow

## Phase 2

- `lib/attribution/attribution-from-truth.ts` — SSOT adapter for `attribution_source`
