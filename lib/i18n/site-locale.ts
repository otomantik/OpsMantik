/**
 * Site locale SSOT.
 *
 * Resolves `{ currency, timezone }` from a site row with strict validation.
 * - Currency: ISO-4217 3-letter uppercase (e.g. USD, TRY, EUR).
 * - Timezone: IANA zone (e.g. UTC, Europe/Istanbul, America/New_York).
 *
 * Neutral fallbacks (UTC / USD) are used when a site lacks config or in
 * dev/test. In production, `assertSiteLocale` MUST succeed and invalid values
 * throw fail-fast.
 */

import { normalizeTimezone } from '@/lib/i18n/timezone';

export const NEUTRAL_TIMEZONE = 'UTC';
export const NEUTRAL_CURRENCY = 'USD';

const ISO_4217_REGEX = /^[A-Z]{3}$/;

export interface SiteLocale {
  currency: string;
  timezone: string;
}

export interface SiteLocaleSource {
  currency?: string | null;
  timezone?: string | null;
}

function normalizeCurrency(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase().replace(/[^A-Z]/g, '');
  return ISO_4217_REGEX.test(s) ? s : null;
}

/**
 * Resolve site locale with neutral fallback.
 * Never throws. Intended for runtime paths that must not crash on missing config.
 */
export function resolveSiteLocale(site: SiteLocaleSource | null | undefined): SiteLocale {
  const currency = normalizeCurrency(site?.currency) ?? NEUTRAL_CURRENCY;
  const timezone = normalizeTimezone(site?.timezone ?? null, NEUTRAL_TIMEZONE);
  return { currency, timezone };
}

/**
 * Strict resolver for write-path / export-path usage.
 * Throws when production site has missing/invalid currency or timezone.
 * In non-production, logs a warning and falls back to neutral values.
 */
export function assertSiteLocale(
  site: SiteLocaleSource | null | undefined,
  context: string
): SiteLocale {
  const currency = normalizeCurrency(site?.currency);
  const rawTz = site?.timezone ?? null;
  const timezone = normalizeTimezone(rawTz, '');

  const isProd = process.env.NODE_ENV === 'production';

  if (!currency) {
    if (isProd) {
      throw new Error(
        `SITE_LOCALE_INVALID_CURRENCY: ${context} — site.currency missing or not ISO-4217 (got ${JSON.stringify(site?.currency ?? null)})`
      );
    }
    return { currency: NEUTRAL_CURRENCY, timezone: timezone || NEUTRAL_TIMEZONE };
  }

  if (!timezone) {
    if (isProd) {
      throw new Error(
        `SITE_LOCALE_INVALID_TIMEZONE: ${context} — site.timezone missing or not IANA (got ${JSON.stringify(rawTz)})`
      );
    }
    return { currency, timezone: NEUTRAL_TIMEZONE };
  }

  return { currency, timezone };
}

/** Best-effort ISO-4217 currency normalizer. Returns NEUTRAL_CURRENCY if invalid. */
export function normalizeCurrencyOrNeutral(raw: string | null | undefined): string {
  return normalizeCurrency(raw) ?? NEUTRAL_CURRENCY;
}
