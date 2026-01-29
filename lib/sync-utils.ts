/**
 * Shared utilities for sync and call-event API routes.
 * Keeps route handlers thinner and avoids duplication.
 */

/**
 * Get recent months for partition filtering.
 * @param months - Number of months to include (default: 6)
 * @returns Array of month strings, e.g. ['2026-01-01', '2025-12-01', ...]
 */
export function getRecentMonths(months: number = 6): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStr = date.toISOString().slice(0, 7) + '-01';
    result.push(monthStr);
  }
  return result;
}

/**
 * Response helper for sync API: guarantees { ok, score } contract.
 * All sync responses MUST include both 'ok' and 'score' keys.
 */
export function createSyncResponse(
  ok: boolean,
  score: number | null,
  data: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ok, score, ...data };
}
