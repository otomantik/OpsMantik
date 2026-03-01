/**
 * @deprecated Use lib/utils/mizan-mantik.ts — calculateConversionValue (unified valuation).
 * Re-exported for backward compatibility.
 */

import {
  calculateConversionValue,
  DEFAULT_AOV,
  type IntentWeights,
} from '@/lib/utils/mizan-mantik';

export type { IntentWeights };
export { DEFAULT_AOV };

/**
 * @deprecated Use calculateConversionValue from mizan-mantik. INTERMEDIATE path without decay.
 */
export function calculateExpectedValue(
  aov: number | null | undefined,
  weights: Record<string, number> | null | undefined,
  intent: string | null | undefined
): number {
  return calculateConversionValue({
    signalType: 'INTERMEDIATE',
    aov,
    intentStage: intent,
    intentWeights: weights ?? undefined,
  });
}
