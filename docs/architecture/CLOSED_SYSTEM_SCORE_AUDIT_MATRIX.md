---
status: reference
---

# Closed system score audit matrix (OpsMantik)

**Org SSOT:** `ssot_100_choice: **A**` — see [CLOSED_SYSTEM_SCORE_CONTRACT.md](./CLOSED_SYSTEM_SCORE_CONTRACT.md) (binary gates G1–G5, `npm run test:release-gates`).

Classifications: **LEAD_QUALITY_SCORE** | **STAGE_ECONOMIC_BASE** | **TRUTH_CLOSURE_SCORE** | **DISPLAY_ONLY** | **LEGACY_OR_AMBIGUOUS** | **UNSAFE_AMBIGUOUS**

| Reference | File | Classification | Risk | Action |
| --- | --- | --- | --- | --- |
| `lead_score` (DB / calls) | `lib/oci/outbox/process-outbox.ts`, `enqueue-seal-conversion.ts`, `runner/queue-value-sync.ts` | LEAD_QUALITY_SCORE | Low | Keep as routing/provenance; never multiply into cents without `LEAD_SCORE_GOOGLE_VALUE_MULTIPLIER_ENABLED`. |
| `CATEGORICAL_SCORES` (25/60/100) | `lib/oci/optimization-contract.ts` | LEAD_QUALITY_SCORE | Low | Single definition; do not import into value SSOT. |
| `systemScore` / `lead_score` → snapshot input | `lib/oci/enqueue-panel-stage-outbox.ts` | LEAD_QUALITY_SCORE | Low | Passed through; `resolveOptimizationValue` ignores for cents. |
| 25 / 60 / 100 buttons | `components/dashboard/lead-action-overlay.tsx` | LEAD_QUALITY_SCORE / DISPLAY_ONLY | Low | Commented; same literals as `CATEGORICAL_SCORES`. |
| `OPTIMIZATION_STAGE_BASES`, `won: 100` | `lib/oci/optimization-contract.ts` | STAGE_ECONOMIC_BASE | — | Canonical only; duplicate maps forbidden (see `conversion-policy-literal-guard.test.ts`). |
| `resolveOptimizationValue`, `systemScore = 0` | `lib/oci/optimization-contract.ts` | STAGE_ECONOMIC_BASE | — | Intentional: no lead multiplier on production value path. |
| `buildOptimizationSnapshot` | `lib/oci/optimization-contract.ts` | STAGE_ECONOMIC_BASE | — | Feeds SSOT snapshot majors. |
| `toExpectedValueCents(optimizationValue)` | `lib/oci/retired-audit-hash.ts` | STAGE_ECONOMIC_BASE | — | Minor units from stage-based majors × 100 (floor ≥ 1). |
| `expected_value_cents` / `value_cents` | `lib/oci/retired-audit-value-ssot.ts` | STAGE_ECONOMIC_BASE | — | Policy + snapshot only; no `lead_score` field here. |
| `resolveRetiredAuditEconomics` / `resolveWonConversionEconomics` | `lib/oci/retired-audit-value-ssot.ts` | STAGE_ECONOMIC_BASE | — | Entry points for row economics. |
| `960`, `10000` (×100 majors→cents) | Tests / hash `optimizationValue * 100` | STAGE_ECONOMIC_BASE | Low | Numeric examples only. |
| `25`, `60`, `100` literals in tests | `tests/unit/oci-value-math.test.ts` (clamp) | LEAD_QUALITY_SCORE / DISPLAY_ONLY | Low | Bounds for `clampSystemScore`; not export value. |
| `truth` / `closure` (audit health) | `scripts/sql/oci_time_ssot_health.sql`, release gates | TRUTH_CLOSURE_SCORE | — | Never assign to Google conversion amount. |
| `truth_closure_score` (concept) | `docs/architecture/CLOSED_SYSTEM_SCORE_CONTRACT.md` | TRUTH_CLOSURE_SCORE | — | Document-only name; not a DB column in value path. |
| `100` in Turkish UX copy | i18n / hunter strings | DISPLAY_ONLY | Low | Not economics unless tied to stage bases in code. |
| `quality_factor` universal formula (legacy) | `resolveQualityFactor` in `optimization-contract.ts` | LEGACY_OR_AMBIGUOUS | Medium | Still defined for helpers; **not** applied in `resolveOptimizationValue` (qf=1). Docs updated in `OCI_VALUE_ENGINES_SSOT.md`. |

**Policy gate:** `LEAD_SCORE_GOOGLE_VALUE_MULTIPLIER_ENABLED` in `lib/oci/optimization-contract.ts` must remain `false` unless promoted via a separate change set.

See [CLOSED_SYSTEM_SCORE_CONTRACT.md](./CLOSED_SYSTEM_SCORE_CONTRACT.md).
