/**
 * Lightweight currency i18n — normalization, resolution, formatting.
 * Never throws in runtime paths.
 */

/** Normalize currency code (3-letter uppercase). Returns fallback on invalid. */
export function normalizeCurrency(code: string | null | undefined, fallback = 'USD'): string {
  try {
    if (code == null || typeof code !== 'string') return fallback;
    const s = String(code).trim().toUpperCase();
    if (s.length !== 3) return fallback;
    return /^[A-Z]{3}$/.test(s) ? s : fallback;
  } catch {
    return fallback;
  }
}

/** Resolve currency from site (or body). Legacy: config.currency, sites.currency. */
export function resolveCurrency(
  site: { currency?: string | null; config?: { currency?: string } | null } | null | undefined,
  body?: { currency?: string } | null
): string {
  try {
    if (body?.currency && typeof body.currency === 'string') {
      return normalizeCurrency(body.currency, 'USD');
    }
    if (site?.currency && typeof site.currency === 'string') {
      return normalizeCurrency(site.currency, 'USD');
    }
    if (site?.config?.currency && typeof site.config.currency === 'string') {
      return normalizeCurrency(site.config.currency, 'USD');
    }
    return 'USD';
  } catch {
    return 'USD';
  }
}

/** Format cents as money string. Never throws. */
export function formatMoneyFromCents(
  cents: number | null | undefined,
  currency: string,
  locale = 'en-US'
): string {
  try {
    if (cents == null || typeof cents !== 'number' || !Number.isFinite(cents)) return '-';
    const amount = cents / 100;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalizeCurrency(currency, 'USD'),
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return '-';
  }
}
