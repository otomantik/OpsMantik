/**
 * Source Truth v2 — single ingest resolver (SSOT when SOURCE_TRUTH_SHADOW_ENABLED).
 */

import { getRefactorFlags } from '@/lib/refactor/flags';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { classifyTraffic } from './truth-engine-core';
import { attributionSourceFromSourceTruth } from './attribution-from-truth';
import { loadPreviousSessionContext } from './temporal-context';
import type { TrafficClassificationV2 } from './truth-engine-types';
import type { AttributionResult } from '@/lib/attribution';

export type ResolveSourceTruthInput = {
  site_id: string;
  session_id?: string | null;
  url: string;
  referrer: string | null;
  user_agent: string;
  fingerprint?: string | null;
};

export type ResolveSourceTruthResult = {
  v2: TrafficClassificationV2;
  attribution: AttributionResult;
  traffic_source: string;
  traffic_medium: string;
};

export function isSourceTruthSsotEnabled(): boolean {
  return getRefactorFlags().source_truth_shadow_enabled;
}

/** Pure v2 classification + legacy projection (no DB). */
export function resolveSourceTruthSync(
  input: ResolveSourceTruthInput,
  previousSession?: import('./truth-engine-types').PreviousSessionContext
): ResolveSourceTruthResult {
  const v2 = classifyTraffic(
    input.url,
    input.referrer ?? '',
    input.user_agent ?? '',
    previousSession
  );
  const attribution = attributionSourceFromSourceTruth(v2);
  return {
    v2,
    attribution,
    traffic_source: v2.traffic_source,
    traffic_medium: v2.traffic_medium,
  };
}

/** Full ingest resolution with temporal DB lookup. */
export async function resolveSourceTruthForIngest(
  input: ResolveSourceTruthInput
): Promise<ResolveSourceTruthResult> {
  incrementRefactorMetric('source_truth_shadow_eval_total');

  const previousSession = await loadPreviousSessionContext({
    siteId: input.site_id,
    fingerprint: input.fingerprint,
    excludeSessionId: input.session_id,
  });

  return resolveSourceTruthSync(input, previousSession);
}
