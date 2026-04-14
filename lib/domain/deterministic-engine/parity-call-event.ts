/**
 * PR4-C — Thin runner: call-event authoritative source_type vs classifier paid-surface parity (telemetry only).
 */

import { determineTrafficSource } from '@/lib/analytics/source-classifier';
import { deriveCallEventAuthoritativePaidOrganic } from '@/lib/domain/deterministic-engine/call-event-authoritative-source';
import { ENGINE_CONTRACT_VERSION } from '@/lib/domain/deterministic-engine/contract';
import { buildClassifierParamsForCallEventParity } from '@/lib/domain/deterministic-engine/call-event-parity-params';
import { paidSurfaceFromCallEventSourceType } from '@/lib/domain/deterministic-engine/call-event-paid-surface';
import { paidSurfaceFromTrafficClassificationV1 } from '@/lib/domain/deterministic-engine/paid-surface';
import { comparePaidSurfaceBuckets } from '@/lib/domain/deterministic-engine/parity-compare';
import { logDebug } from '@/lib/logging/logger';
import { getRefactorFlags } from '@/lib/refactor/flags';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';

/** Placeholder URL when intent_page_url is missing — classifier still evaluates merged params. */
const PARITY_URL_FALLBACK = 'https://opsmantik.invalid/call-event-parity';

export type CallEventPaidSurfaceParityInput = {
  siteId: string;
  intentPageUrl: string | null;
  sanitizedGclid: string | null;
  sanitizedWbraid: string | null;
  sanitizedGbraid: string | null;
  sanitizedClickId: string | null;
};

/**
 * When TRUTH_ENGINE_CONSOLIDATED_ENABLED is false: no-op.
 * Primary bucket: same boolean as calls.source_type (paid if any sanitized id present).
 * Shadow: determineTrafficSource(intent_page_url or fallback, '', merged params) → PR4-B v1 bucket map.
 */
export function runCallEventPaidSurfaceParity(input: CallEventPaidSurfaceParityInput): void {
  if (!getRefactorFlags().truth_engine_consolidated_enabled) {
    return;
  }

  const authoritativeSourceType = deriveCallEventAuthoritativePaidOrganic({
    sanitizedGclid: input.sanitizedGclid,
    sanitizedWbraid: input.sanitizedWbraid,
    sanitizedGbraid: input.sanitizedGbraid,
    sanitizedClickId: input.sanitizedClickId,
  });
  const primary = paidSurfaceFromCallEventSourceType(authoritativeSourceType);

  const params = buildClassifierParamsForCallEventParity({
    sanitizedGclid: input.sanitizedGclid,
    sanitizedWbraid: input.sanitizedWbraid,
    sanitizedGbraid: input.sanitizedGbraid,
    intentPageUrl: input.intentPageUrl,
  });
  const urlForClassifier = input.intentPageUrl?.trim() ? input.intentPageUrl.trim() : PARITY_URL_FALLBACK;
  const tc = determineTrafficSource(urlForClassifier, '', params);
  const shadow = paidSurfaceFromTrafficClassificationV1(tc);
  const outcome = comparePaidSurfaceBuckets(primary, shadow);

  incrementRefactorMetric('truth_engine_consolidated_call_event_parity_check_total');
  if (outcome === 'match') {
    incrementRefactorMetric('truth_engine_consolidated_call_event_parity_match_total');
    return;
  }

  incrementRefactorMetric('truth_engine_consolidated_call_event_parity_mismatch_total');
  logDebug('ENGINE_CONSOLIDATED_CALL_EVENT_PARITY_MISMATCH', {
    contract: ENGINE_CONTRACT_VERSION,
    site_id: input.siteId,
    primary_bucket: primary,
    shadow_bucket: shadow,
    traffic_medium: tc.traffic_medium,
    traffic_source: tc.traffic_source,
    call_source_type_authoritative: authoritativeSourceType,
  });
}
