/**
 * Deterministic landing URL normalization for 10s page_view session reuse.
 * Strip fragment and UTM/click-id params so same landing page compares equal.
 */

const STRIP_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_adgroup',
  'gclid', 'wbraid', 'gbraid', 'gclsrc', 'fbclid', 'ttclid', 'msclkid',
  'matchtype', 'device', 'devicemodel', 'targetid', 'network', 'adposition', 'feeditemid',
  'loc_interest_ms', 'loc_physical_ms',
]);

/**
 * Normalize URL for session reuse comparison: strip fragment and UTM/ads params.
 * Deterministic: same logical landing page yields the same string.
 */
export function normalizeLandingUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';
  let href: string;
  try {
    const u = new URL(url);
    u.hash = '';
    const params = u.searchParams;
    STRIP_PARAMS.forEach((name) => params.delete(name));
    u.search = params.toString();
    href = u.href;
  } catch {
    return url.split('#')[0].split('?')[0] || url;
  }
  return href;
}
