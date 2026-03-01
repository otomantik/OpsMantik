/**
 * MizanMantik 5-Gear — Domain Orchestrator
 */

export { evaluateAndRouteSignal, resolveGearFromLegacy } from './orchestrator';
export { getBaseValueForGear, getDecayProfileForGear, calculateSignalEV } from './time-decay';
export {
  calculateConversionValueMinor,
  AOV_FLOOR_MAJOR,
  type ConversionValueParams,
} from './value-calculator';
export type { OpsGear, SignalPayload, EvaluateResult, LegacySignalType } from './types';
export { LEGACY_TO_OPS_GEAR } from './types';
export { OPSMANTIK_CONVERSION_NAMES } from './conversion-names';
