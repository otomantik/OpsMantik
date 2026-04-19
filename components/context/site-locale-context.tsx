'use client';

/**
 * Site locale React context — propagates the active site's timezone +
 * currency + locale to every component in the dashboard tree so clocks and
 * money displays match the customer's locale instead of the hardcoded
 * Europe/Istanbul fallback that used to live in `formatTimestamp`.
 *
 * Usage:
 *
 *   // At the dashboard root (server component, after fetching the site):
 *   <SiteLocaleProvider value={{
 *     timezone: site.timezone,
 *     currency: site.currency,
 *     locale: site.locale ?? 'en-US',
 *   }}>
 *     {children}
 *   </SiteLocaleProvider>
 *
 *   // In any descendant client component:
 *   const { timezone, currency, locale } = useSiteLocale();
 *
 * The neutral defaults (UTC / USD / en-US) match
 * `lib/i18n/site-locale.ts` so code that renders before the provider mounts
 * (or in storybook-style isolation) still behaves sensibly.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  NEUTRAL_CURRENCY,
  NEUTRAL_TIMEZONE,
  type SiteLocale,
} from '@/lib/i18n/site-locale';

export const NEUTRAL_UI_LOCALE = 'en-US';

export interface SiteLocaleContextValue extends SiteLocale {
  /** BCP-47 locale (e.g. 'en-US', 'tr-TR'). */
  locale: string;
}

const DEFAULT_VALUE: SiteLocaleContextValue = {
  timezone: NEUTRAL_TIMEZONE,
  currency: NEUTRAL_CURRENCY,
  locale: NEUTRAL_UI_LOCALE,
};

const SiteLocaleContext = createContext<SiteLocaleContextValue>(DEFAULT_VALUE);

export interface SiteLocaleProviderProps {
  value: Partial<SiteLocaleContextValue>;
  children: ReactNode;
}

/**
 * Provide a site locale to the subtree. Undefined / blank fields fall back to
 * neutral defaults — never to Europe/Istanbul or TRY.
 */
export function SiteLocaleProvider({ value, children }: SiteLocaleProviderProps) {
  const resolved = useMemo<SiteLocaleContextValue>(() => {
    const timezone =
      typeof value.timezone === 'string' && value.timezone.trim()
        ? value.timezone.trim()
        : NEUTRAL_TIMEZONE;
    const currency =
      typeof value.currency === 'string' && value.currency.trim()
        ? value.currency.trim().toUpperCase()
        : NEUTRAL_CURRENCY;
    const locale =
      typeof value.locale === 'string' && value.locale.trim()
        ? value.locale.trim()
        : NEUTRAL_UI_LOCALE;
    return { timezone, currency, locale };
  }, [value.timezone, value.currency, value.locale]);

  return (
    <SiteLocaleContext.Provider value={resolved}>
      {children}
    </SiteLocaleContext.Provider>
  );
}

/** Access the active site's locale. Always returns neutral defaults outside a provider. */
export function useSiteLocale(): SiteLocaleContextValue {
  return useContext(SiteLocaleContext);
}

/** Shorthand for the timezone — most UI components only need this. */
export function useSiteTimezone(): string {
  return useContext(SiteLocaleContext).timezone;
}
