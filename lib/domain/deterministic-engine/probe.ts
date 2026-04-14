/**
 * PR4-A — Shadow probe helper (metrics + optional debug logs only).
 */

import { logDebug } from '@/lib/logging/logger';
import { getRefactorFlags } from '@/lib/refactor/flags';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { ENGINE_CONTRACT_VERSION, type DeterministicEngineProbeKind } from '@/lib/domain/deterministic-engine/contract';

export type DeterministicEngineProbeContext = {
  kind: DeterministicEngineProbeKind;
  siteId: string;
};

/**
 * When TRUTH_ENGINE_CONSOLIDATED_ENABLED is false: no-op (no metrics, no logs).
 * When true: increments truth_engine_consolidated_probe_total and emits ENGINE_CONSOLIDATED_PROBE debug log.
 */
export function runDeterministicEngineProbe(ctx: DeterministicEngineProbeContext): void {
  if (!getRefactorFlags().truth_engine_consolidated_enabled) {
    return;
  }

  incrementRefactorMetric('truth_engine_consolidated_probe_total');

  logDebug('ENGINE_CONSOLIDATED_PROBE', {
    contract: ENGINE_CONTRACT_VERSION,
    kind: ctx.kind,
    site_id: ctx.siteId,
  });
}
