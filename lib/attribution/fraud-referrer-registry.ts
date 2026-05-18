/** Known suspicious referrer host suffixes (bot farms, click spam). */

const FRAUD_REFERRER_SUFFIXES = [
  'semalt.com',
  'buttons-for-website.com',
  'darodar.com',
  'ilovevitaly.com',
  'priceg.com',
  'blackhatworth.com',
  'best-seo-offer.com',
  'best-seo-solution.com',
  'googlsucks.com',
  'humanorightswatch.org',
  'simple-share-buttons.com',
  'social-buttons.com',
  'trafficmonetize.org',
  'webmasterbeta.com',
] as const;

export function isFraudReferrerHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/^www\./, '');
  for (const suffix of FRAUD_REFERRER_SUFFIXES) {
    if (h === suffix || h.endsWith('.' + suffix) || h.includes(suffix)) return true;
  }
  return false;
}
