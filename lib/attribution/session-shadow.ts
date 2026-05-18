import { getRefactorFlags } from '@/lib/refactor/flags';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { evaluateSourceTruthShadow } from './shadow-evaluator';
import type { TrafficClassificationV2 } from './truth-engine-types';

export type SessionShadowInput = {
  site_id: string;
  session_id: string;
  url: string;
  referrer: string | null;
  user_agent: string;
  fingerprint?: string | null;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  } | null;
  has_past_valid_click_id?: boolean;
};

/** Shadow ledger JSONB — never mutates legacy columns. */
export async function buildTrafficV2Ledger(
  input: SessionShadowInput
): Promise<TrafficClassificationV2 | null> {
  if (!getRefactorFlags().source_truth_shadow_enabled) return null;

  incrementRefactorMetric('source_truth_shadow_eval_total');

  const result = await evaluateSourceTruthShadow({
    site_id: input.site_id,
    url: input.url,
    referrer: input.referrer,
    user_agent: input.user_agent,
    fingerprint: input.fingerprint,
    exclude_session_id: input.session_id,
    gclid: input.gclid,
    wbraid: input.wbraid,
    gbraid: input.gbraid,
    utm: input.utm,
    has_past_valid_click_id: input.has_past_valid_click_id,
  });

  if (result.drift.is_paid_mismatch) {
    incrementRefactorMetric('source_truth_shadow_drift_paid_total');
  }
  if (result.drift.channel_mismatch) {
    incrementRefactorMetric('source_truth_shadow_drift_channel_total');
  }

  return result.v2;
}
