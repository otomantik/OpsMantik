import type { OptimizationStage } from '@/lib/oci/optimization-contract';

export const OPSMANTIK_CONVERSION_NAMES: Record<OptimizationStage, string> = {
  junk: 'OpsMantik_Junk_Exclusion',
  contacted: 'OpsMantik_Contacted',
  offered: 'OpsMantik_Offered',
  won: 'OpsMantik_Won',
};

export function resolveOciConversionName(stage: OptimizationStage): string {
  return OPSMANTIK_CONVERSION_NAMES[stage];
}

export function isOciCanonicalStage(value: string): value is OptimizationStage {
  return Object.prototype.hasOwnProperty.call(OPSMANTIK_CONVERSION_NAMES, value);
}
