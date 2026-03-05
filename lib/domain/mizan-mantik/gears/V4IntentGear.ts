/**
 * Phase 20: V4_INTENT — marketing_signals (Aggressive decay)
 */

import type { SignalPayload } from '../types';
import type { CausalDna } from '../causal-dna';
import type { AbstractGear, GearContext, PreValidateResult } from './AbstractGear';
import type { EvaluateResult } from '../types';
import { insertMarketingSignal } from './marketing-signals-insert';

export class V4IntentGear implements AbstractGear {
  readonly gear = 'V4_INTENT' as const;

  async preValidate(_payload: SignalPayload, dna: CausalDna, _context: GearContext): Promise<PreValidateResult> {
    return { pass: true, dna };
  }

  calculateEconomicValue(): number {
    return 0;
  }

  generateCausalDNA(): CausalDna {
    throw new Error('V4 uses insertMarketingSignal for DNA');
  }

  async route(
    payload: SignalPayload,
    dna: CausalDna,
    context: GearContext
  ): Promise<EvaluateResult> {
    const result = await insertMarketingSignal({
      siteId: context.siteId,
      callId: payload.callId ?? null,
      traceId: payload.traceId ?? null,
      gear: this.gear,
      payload,
      config: context.config,
      dna,
      entropyScore: context.entropyScore,
      uncertaintyBit: context.uncertaintyBit,
    });
    if (!result.success) {
      return { routed: false, conversionValue: 0, causalDna: result.causalDna };
    }
    return {
      routed: true,
      signalId: result.signalId,
      conversionValue: result.conversionValue,
      causalDna: result.causalDna,
    };
  }
}
