import { applyLegacyProjection } from '../legacy-adapters';
import type { TrafficClassificationV2 } from '../truth-engine-types';
import { REASON } from '../reason-codes';
import type { ClassificationContext } from './context';
import {
  confidenceLabelFromScore,
  confidenceScoreFromContext,
  computeSignalEntropy,
} from './entropy';
import { pushTrace } from './trace';

export function assembleVerdict(ctx: ClassificationContext): TrafficClassificationV2 {
  const draft = ctx.verdict ?? {
    channel: 'unknown' as const,
    is_paid: false,
    reason_code: REASON.TAGGED_UNKNOWN,
    identity_grade: 'direct_unknown' as const,
  };

  const confidence_score = confidenceScoreFromContext(ctx);
  const confidence_label = confidenceLabelFromScore(confidence_score);
  const signal_entropy_score = computeSignalEntropy(ctx);

  const identity_grade =
    draft.identity_grade ??
    (ctx.sanitized.gclid
      ? 'click_id_strong'
      : ctx.sanitized.wbraid || ctx.sanitized.gbraid
        ? 'click_id_ios'
        : draft.channel === 'dark_return'
          ? 'click_id_assisted'
          : draft.reason_code === REASON.UTM_PAID_SOCIAL || draft.reason_code === REASON.UTM_DARK_SOCIAL
            ? 'utm_only'
            : ctx.referrerHost
              ? 'referrer_only'
              : 'direct_unknown');

  pushTrace(
    ctx,
    'VERDICT',
    `channel=${draft.channel} is_paid=${draft.is_paid} reason=${draft.reason_code}`
  );

  const base: TrafficClassificationV2 = {
    traffic_source: '',
    traffic_medium: '',
    channel: draft.channel,
    is_paid: draft.is_paid,
    classifier_version: 'source_truth_v2',
    reason_code: draft.reason_code,
    confidence_score,
    confidence_label,
    selected_evidence: [...ctx.selected_evidence],
    ignored_evidence: [...ctx.ignored_evidence],
    contradiction_reasons: [...ctx.contradiction_reasons],
    contradiction_score: ctx.contradiction_score,
    decision_trace: [...ctx.decision_trace],
    signal_entropy_score,
    is_fraud_suspected: ctx.is_fraud_suspected,
    identity_grade,
    primary_credit: 100,
    assist_channels: [...ctx.assist_channels],
  };

  return applyLegacyProjection(base);
}
