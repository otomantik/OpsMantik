/**
 * Shared time utilities (PR-VK-3: Decay Days SSOT)
 *
 * calculateDecayDays: Single source for elapsed days between click and signal.
 * Clamp max 365 (1yr); ceil mode = advertiser-friendly (1h = day 1).
 */

const MS_PER_DAY = 86400000;
const MAX_DAYS = 365; // 1yr; BI/OCI friendly

/**
 * Elapsed days between click and signal.
 * mode=ceil: 1h elapsed = day 1 (advertiser-friendly; aligns with Google Ads)
 * mode=floor: 1h elapsed = day 0
 * Clamped to [0, 365].
 */
export function calculateDecayDays(
  clickDate: Date,
  signalDate: Date,
  mode: 'ceil' | 'floor' = 'ceil'
): number {
  const elapsedMs = Math.max(0, signalDate.getTime() - clickDate.getTime());
  const rawDays = elapsedMs / MS_PER_DAY;
  const days =
    mode === 'ceil'
      ? Math.ceil(rawDays)
      : Math.floor(rawDays);
  return Math.min(MAX_DAYS, Math.max(0, days));
}
