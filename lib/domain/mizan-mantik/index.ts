/**
 * MizanMantik 5-Gear — Domain Orchestrator
 */

export { evaluateAndRouteSignal } from './orchestrator';
export { getBaseValueForGear, getDecayProfileForGear, calculateSignalEV } from './time-decay';
export {
  calculateConversionValueMinor,
  resolveConversionValueMinor,
  resolveSignalFloorMinor,
  AOV_FLOOR_MAJOR,
  type ConversionValueParams,
  type ResolvedConversionValue,
} from './value-calculator';
export type { OpsGear, SignalPayload, EvaluateResult, LegacySignalType } from './types';
export { LEGACY_TO_OPS_GEAR } from './types';
export { OPSMANTIK_CONVERSION_NAMES } from './conversion-names';
export { getEntropyScore, type EntropyResult } from './entropy-service';
export { createCausalDna, appendBranch, toJsonb, buildMinimalCausalDna } from './causal-dna';
