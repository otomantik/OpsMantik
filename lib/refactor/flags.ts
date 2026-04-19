/**
 * Attribution Truth Engine refactor — rollout flags.
 *
 * Each flag gates a specialized rollout surface:
 *   - TRUTH_SHADOW_WRITE_ENABLED           → truth_evidence_ledger inserts.
 *   - TRUTH_TYPED_EVIDENCE_ENABLED         → v2 envelope + Zod validation for payload.
 *   - TRUTH_INFERENCE_REGISTRY_ENABLED     → append-only truth_inference_runs.
 *   - IDENTITY_GRAPH_ENABLED               → append-only truth_identity_graph_edges.
 *   - TRUTH_ENGINE_CONSOLIDATED_ENABLED    → deterministic-engine parity probes.
 *   - TRUTH_CANONICAL_LEDGER_SHADOW_ENABLED → truth_canonical_ledger shadow writes.
 *   - CONSENT_PROVENANCE_SHADOW_ENABLED    → consent provenance shadow audit.
 *   - EXPLAINABILITY_API_ENABLED           → /api/truth/explain endpoint.
 *   - LEGACY_ENDPOINTS_ENABLED             → keep legacy ingest paths alive.
 *
 * The old TRUTH_PROJECTION_READ_ENABLED flag was removed along with
 * lib/domain/truth/projection-dual-read.ts. Any residual env var is ignored.
 */

export type RefactorFlags = {
  truth_shadow_write_enabled: boolean;
  truth_typed_evidence_enabled: boolean;
  /** PR4-A/B/C: deterministic-engine probe + attribution + call-event parity; default off. */
  truth_engine_consolidated_enabled: boolean;
  truth_inference_registry_enabled: boolean;
  identity_graph_enabled: boolean;
  explainability_api_enabled: boolean;
  legacy_endpoints_enabled: boolean;
  /** PR2: consent provenance shadow checks on sync (and call-event when match data available); no enforcement. */
  consent_provenance_shadow_enabled: boolean;
  /** PR3: canonical truth substrate shadow rows; no read cutover. */
  truth_canonical_ledger_shadow_enabled: boolean;
};

function asBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  const t = v.trim().toLowerCase();
  if (t === '1' || t === 'true' || t === 'on' || t === 'yes') return true;
  if (t === '0' || t === 'false' || t === 'off' || t === 'no') return false;
  return fallback;
}

/** Defaults keep current production behavior (all specialized paths off; legacy endpoints on). */
export function getRefactorFlags(): RefactorFlags {
  return {
    truth_shadow_write_enabled: asBool(process.env.TRUTH_SHADOW_WRITE_ENABLED, false),
    truth_typed_evidence_enabled: asBool(process.env.TRUTH_TYPED_EVIDENCE_ENABLED, false),
    truth_engine_consolidated_enabled: asBool(process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED, false),
    truth_inference_registry_enabled: asBool(process.env.TRUTH_INFERENCE_REGISTRY_ENABLED, false),
    identity_graph_enabled: asBool(process.env.IDENTITY_GRAPH_ENABLED, false),
    explainability_api_enabled: asBool(process.env.EXPLAINABILITY_API_ENABLED, false),
    legacy_endpoints_enabled: asBool(process.env.LEGACY_ENDPOINTS_ENABLED, true),
    consent_provenance_shadow_enabled: asBool(process.env.CONSENT_PROVENANCE_SHADOW_ENABLED, false),
    truth_canonical_ledger_shadow_enabled: asBool(process.env.TRUTH_CANONICAL_LEDGER_SHADOW_ENABLED, false),
  };
}
