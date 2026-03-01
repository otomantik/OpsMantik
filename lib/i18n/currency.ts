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

/**
 * Currency minor units (decimal places). Used for value pipeline consistency.
 * TRY/EUR/USD = 2; JPY/KRW = 0; KWD/BHD = 3.
 */
const CURRENCY_MINOR_UNITS: Record<string, number> = {
  TRY: 2, EUR: 2, USD: 2, GBP: 2, CHF: 2, CAD: 2, AUD: 2, NZD: 2,
  DKK: 2, NOK: 2, SEK: 2, PLN: 2, CZK: 2, HUF: 2, RON: 2, BGN: 2,
  ZAR: 2, MXN: 2, BRL: 2, CNY: 2, INR: 2, RUB: 2,
  JPY: 0, KRW: 0, CLP: 0, PYG: 0, VND: 0, IDR: 0, ISK: 0,
  KWD: 3, BHD: 3, OMR: 3, JOD: 3, TND: 3,
};

/** Returns minor unit decimal places for currency. Default 2 for unknown. */
export function getMinorUnits(currency: string | null | undefined): number {
  if (currency == null || typeof currency !== 'string') return 2;
  const code = String(currency).trim().toUpperCase().slice(0, 3);
  return CURRENCY_MINOR_UNITS[code] ?? 2;
}

/** Convert major units to minor (integer). E.g. 1000 TRY → 100000. */
export function majorToMinor(major: number, currency: string | null | undefined): number {
  const minorUnits = getMinorUnits(currency);
  return Math.round(major * Math.pow(10, minorUnits));
}

/** Convert minor units to major (for display/export). E.g. 100000 TRY → 1000. */
export function minorToMajor(minor: number, currency: string | null | undefined): number {
  const minorUnits = getMinorUnits(currency);
  return minor / Math.pow(10, minorUnits);
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

/** Format minor units as money string. Never throws. Uses getMinorUnits for JPY/KWD. */
export function formatMoneyFromCents(
  minorUnits: number | null | undefined,
  currency: string,
  locale = 'en-US'
): string {
  try {
    if (minorUnits == null || typeof minorUnits !== 'number' || !Number.isFinite(minorUnits)) return '-';
    const amount = minorToMajor(minorUnits, currency);
    const minor = getMinorUnits(currency);
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalizeCurrency(currency, 'USD'),
      minimumFractionDigits: 0,
      maximumFractionDigits: minor,
    }).format(amount);
  } catch {
    return '-';
  }
}
