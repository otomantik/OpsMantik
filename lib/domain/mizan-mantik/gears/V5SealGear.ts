/**
 * Phase 20: V5_SEAL — Iron Seal, valueCents/100, no decay
 */

import { appendBranch, toJsonb } from '../causal-dna';
import type { SignalPayload } from '../types';
import type { CausalDna } from '../causal-dna';
import type { AbstractGear, GearContext, PreValidateResult } from './AbstractGear';
import type { EvaluateResult } from '../types';

export class V5SealGear implements AbstractGear {
  readonly gear = 'V5_SEAL' as const;

  async preValidate(
    _payload: SignalPayload,
    dna: CausalDna,
    _context: GearContext
  ): Promise<PreValidateResult> {
    return { pass: true, dna };
  }

  calculateEconomicValue(payload: SignalPayload, context: GearContext): number {
    let cents = Number(payload.valueCents);
    if (!Number.isFinite(cents) || cents <= 0) {
      cents = context.config?.minConversionValueCents ?? 100000;
    }
    return Math.round((cents / 100) * 100) / 100;
  }

  generateCausalDNA(
    dna: CausalDna,
    payload: SignalPayload,
    _context: GearContext,
    result: { conversionValue: number }
  ): CausalDna {
    const cents = Number(payload.valueCents);
    return appendBranch(
      dna,
      'V5_SEAL_Standard_Conversion',
      ['auth', 'idempotency', 'usage'],
      { valueCents: cents, raw: payload.valueCents },
      { conversionValue: result.conversionValue, math_version: 'v1.0.5' }
    );
  }

  async route(
    payload: SignalPayload,
    dna: CausalDna,
    context: GearContext
  ): Promise<EvaluateResult> {
    const conversionValue = this.calculateEconomicValue(payload, context);
    dna = this.generateCausalDNA(dna, payload, context, { conversionValue });
    return { routed: true, conversionValue, causalDna: toJsonb(dna) };
  }
}
