/**
 * Mizan Mantik: Canonical Stage Router
 * Directs pure mathematical payloads into the funnel ledger.
 */

import type { PipelineStage, SignalPayload, EvaluateResult } from '../types';
import type { CausalDna } from '../causal-dna';
import { appendBranch, toJsonb } from '../causal-dna';
import { insertMarketingSignal } from '../insert-marketing-signal';

export interface RouterContext {
  siteId: string;
  entropyScore: number;
  uncertaintyBit: boolean | null;
}

export async function routeStage(
  stage: PipelineStage,
  payload: SignalPayload,
  context: RouterContext,
  dna: CausalDna
): Promise<EvaluateResult> {
  const { siteId, callId, traceId } = payload;
  let workingDna = dna;

  // Pre-validation block
  if (!callId) {
    workingDna = appendBranch(workingDna, 'pre_route_reject', ['validation'], {}, { reason: 'missing_callId' });
    return { routed: false, conversionValue: 0, dropped: true, causalDna: toJsonb(workingDna) };
  }

  workingDna = appendBranch(workingDna, 'pre_route_pass', ['validation'], { callId, stage }, {});

  // Junk and 'won' both short-circuit here so they never reach insertMarketingSignal.
  //   - 'junk' has no economic value.
  //   - 'won' is exclusively owned by the seal path (enqueueSealConversion →
  //     offline_conversion_queue). Router-side inserts only emit intent-level
  //     rows (`contacted`, `offered`).
  if (stage === 'junk' || stage === 'won') {
    workingDna = appendBranch(
      workingDna,
      stage === 'junk' ? 'junk_drop' : 'won_seal_only',
      stage === 'junk' ? [] : ['seal_ownership'],
      {},
      {
        reason:
          stage === 'junk'
            ? 'junk_stage_has_no_marketing_signal'
            : 'won_is_owned_by_seal_enqueue_path',
      }
    );
    return { routed: false, conversionValue: 0, dropped: true, causalDna: toJsonb(workingDna) };
  }

  // Canonical stages (contacted, offered) go directly into marketing signals with mathematical snapshot evaluation
  const result = await insertMarketingSignal({
    siteId,
    callId,
    traceId: traceId ?? null,
    stage,
    payload,
    dna: workingDna,
    entropyScore: context.entropyScore,
    uncertaintyBit: context.uncertaintyBit,
  });

  return {
    routed: result.success,
    signalId: result.signalId,
    conversionValue: result.conversionValue,
    dropped: !result.success,
    causalDna: result.causalDna,
  };
}
