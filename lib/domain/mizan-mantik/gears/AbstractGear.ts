/**
 * Phase 20: Gear-Strategy Engine — Abstract contract for V1–V5 gears.
 */

import type { OpsGear, SignalPayload, EvaluateResult } from '../types';
import type { CausalDna } from '../causal-dna';
import type { ValueConfig } from '../value-config';

export interface GearContext {
  siteId: string;
  config: ValueConfig | null; // V1 does not need config
  entropyScore: number;
  uncertaintyBit: boolean | null; // matches getEntropyScore and DB column
}

export interface PreValidateResult {
  pass: boolean;
  dna: CausalDna;
  dropped?: boolean;
  dropReason?: string;
}

export abstract class AbstractGear {
  abstract readonly gear: OpsGear;

  /** Pre-validate payload; return pass/fail and updated DNA. */
  abstract preValidate(
    payload: SignalPayload,
    dna: CausalDna,
    context: GearContext
  ): Promise<PreValidateResult>;

  /** Compute conversion value in major units (for API/Google Ads). */
  abstract calculateEconomicValue(
    payload: SignalPayload,
    context: GearContext
  ): number;

  /** Generate Causal DNA branch for this gear's routing decision. */
  abstract generateCausalDNA(
    dna: CausalDna,
    payload: SignalPayload,
    context: GearContext,
    result: { conversionValue: number; [k: string]: unknown }
  ): CausalDna;

  /** Execute routing (Redis, marketing_signals, etc.). Returns EvaluateResult. */
  abstract route(
    payload: SignalPayload,
    dna: CausalDna,
    context: GearContext
  ): Promise<EvaluateResult>;
}
