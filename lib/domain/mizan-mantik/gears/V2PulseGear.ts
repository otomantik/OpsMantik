/**
 * Phase 20: V2_PULSE — Dedup check then marketing_signals (Soft decay)
 */

import { appendBranch } from '../causal-dna';
import { calculateSignalEV } from '../time-decay';
import { getValueFloorCents } from '../value-config';
import { calculateDecayDays } from '@/lib/shared/time-utils';
import type { SignalPayload } from '../types';
import type { CausalDna } from '../causal-dna';
import type { AbstractGear, GearContext, PreValidateResult } from './AbstractGear';
import type { EvaluateResult } from '../types';
import { hasRecentV2Pulse, logShadowDecision } from './shared';
import { insertMarketingSignal } from './marketing-signals-insert';

export class V2PulseGear implements AbstractGear {
  readonly gear = 'V2_PULSE' as const;

  async preValidate(
    payload: SignalPayload,
    dna: CausalDna,
    context: GearContext
  ): Promise<PreValidateResult> {
    const { siteId } = context;
    const { callId, gclid, discriminator } = payload;
    const hasDiscriminator = discriminator != null && String(discriminator).trim() !== '';

    if (!hasDiscriminator) {
      const dup = await hasRecentV2Pulse(siteId, callId, gclid ?? undefined);
      if (dup) {
        dna = appendBranch(dna, 'V2_PULSE_Dropped', ['auth', 'dedup_fail'],
          { callId, gclid: gclid ?? null }, { reason: 'hasRecentV2Pulse' });
        logShadowDecision(siteId, 'signal', null, 'V2_PULSE', 'hasRecentV2Pulse: duplicate pulse in 24h',
          { callId: callId ?? null, gclid: gclid ?? null });
        return { pass: false, dna, dropped: true, dropReason: 'hasRecentV2Pulse' };
      }
      dna = appendBranch(dna, 'V2_PULSE_DedupPass', ['auth', 'dedup'], {}, {});
    } else {
      dna = appendBranch(dna, 'V2_PULSE_DiscriminatorPass', ['auth', 'dedup_bypass'], { discriminator }, {});
    }
    return { pass: true, dna };
  }

  calculateEconomicValue(payload: SignalPayload, context: GearContext): number {
    if (!context.config) return 0;
    const aovCents = Math.round(Number(context.config.defaultAov ?? payload.aov ?? 0) * 100);
    let finalCents = calculateSignalEV(
      this.gear,
      aovCents,
      payload.clickDate,
      payload.signalDate,
      context.config.intentWeights
    );
    const floorCents = getValueFloorCents(context.config);
    if (finalCents < floorCents) finalCents = floorCents;
    return finalCents / 100;
  }

  generateCausalDNA(): CausalDna {
    throw new Error('V2 uses insertMarketingSignal for DNA');
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
