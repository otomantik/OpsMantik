/**
 * MizanMantik — Time-Decayed Expected Value (EV) Engine
 *
 * Fast-Closer Bias: Signals closer to the click get higher value.
 * Buckets: HOT (≤3d) 50%, WARM (4–10d) 25%, COLD (>10d) 10%.
 */

/**
 * Calculate time-decayed conversion value.
 * @param baseValue - Base value (e.g. AOV or revenue)
 * @param clickDate - When the user clicked the ad
 * @param signalDate - When the signal/event occurred
 * @returns Rounded conversion value
 */
export function calculateDecayedValue(
  baseValue: number,
  clickDate: Date,
  signalDate: Date
): number {
  const elapsedMs = Math.max(0, signalDate.getTime() - clickDate.getTime());
  const days = Math.ceil(elapsedMs / 86400000);

  const b = Number.isFinite(baseValue) && baseValue >= 0 ? baseValue : 0;
  let multiplier: number;

  if (days <= 3) {
    multiplier = 0.5;  // HOT
  } else if (days <= 10) {
    multiplier = 0.25; // WARM
  } else {
    multiplier = 0.1;  // COLD
  }

  return Math.round(b * multiplier);
}
