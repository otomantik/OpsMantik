/**
 * MizanMantik Score Utils (PR-VK-4)
 *
 * leadScoreToStar: 0-100 scale → 1–5 stars (0 → null).
 * Logic: round(clamp(0,100) / 20); map 0 → null.
 */

export type StarRating = 1 | 2 | 3 | 4 | 5;

/**
 * Convert lead_score (0-100) to star rating (1-5).
 * 0 → null; 1-20→1, 21-40→2, 41-60→3, 61-80→4, 81-100→5.
 */
export function leadScoreToStar(leadScore: number | null): StarRating | null {
  if (leadScore == null || !Number.isFinite(leadScore)) return null;
  const clamped = Math.max(0, Math.min(100, leadScore));
  const star = Math.round(clamped / 20);
  return star === 0 ? null : (star as StarRating);
}
