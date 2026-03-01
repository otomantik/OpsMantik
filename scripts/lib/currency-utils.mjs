/**
 * V5_SEAL currency utilities — mirrors lib/i18n/currency.ts for standalone scripts.
 * Use getMinorUnits + majorToMinor so value_cents pushed to DB matches War Room output.
 * V5 bypasses legacy oci_config multipliers; sale_amount (or 0) exactly.
 */

const CURRENCY_MINOR_UNITS = {
  TRY: 2, EUR: 2, USD: 2, GBP: 2, CHF: 2, CAD: 2, AUD: 2, NZD: 2,
  DKK: 2, NOK: 2, SEK: 2, PLN: 2, CZK: 2, HUF: 2, RON: 2, BGN: 2,
  ZAR: 2, MXN: 2, BRL: 2, CNY: 2, INR: 2, RUB: 2,
  JPY: 0, KRW: 0, CLP: 0, PYG: 0, VND: 0, IDR: 0, ISK: 0,
  KWD: 3, BHD: 3, OMR: 3, JOD: 3, TND: 3,
};

export function getMinorUnits(currency) {
  if (currency == null || typeof currency !== 'string') return 2;
  const code = String(currency).trim().toUpperCase().slice(0, 3);
  return CURRENCY_MINOR_UNITS[code] ?? 2;
}

/**
 * Convert major units to minor (integer). E.g. 1000 TRY → 100000.
 * V5_SEAL: Use for calls.sale_amount (major) → value_cents (minor). No proxy multipliers.
 */
export function majorToMinor(major, currency) {
  const minorUnits = getMinorUnits(currency);
  return Math.round(major * Math.pow(10, minorUnits));
}
