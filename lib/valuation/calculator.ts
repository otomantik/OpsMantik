/**
 * Lead valuation for "Lazy Antiques Dealer" / Proxy Value Strategy.
 * When the user does not enter a sale amount, we derive a proxy value from the 0–5 score
 * and the site's default deal value.
 */

/**
 * Computes the monetary value of a lead for ROAS/OCI.
 *
 * - If the user entered a price (sale_amount), that is returned.
 * - Otherwise applies the tiered proxy formula from the lead score and site default.
 *
 * @param score - Lead quality score 0–5 (0 = junk, 1–5 = user rating).
 * @param userEnteredPrice - Actual sale_amount from the user, or null/0 if not entered.
 * @param siteDefaultValue - Site's average deal value (sites.default_deal_value); use 0 if null/undefined.
 * @returns The value to use (>= 0).
 */
export function calculateLeadValue(
  score: number,
  userEnteredPrice: number | null | undefined,
  siteDefaultValue: number
): number {
  const entered = userEnteredPrice != null && Number.isFinite(userEnteredPrice) && userEnteredPrice > 0;
  if (entered) {
    return Math.max(0, userEnteredPrice);
  }

  const defaultVal = siteDefaultValue != null && Number.isFinite(siteDefaultValue) ? Math.max(0, siteDefaultValue) : 0;
  const s = Math.floor(Number(score));
  if (s <= 0) return 0;
  if (s <= 2) return defaultVal * 0.1;
  if (s === 3) return defaultVal * 0.3;
  return defaultVal * 1.0; // 4 or 5
}
