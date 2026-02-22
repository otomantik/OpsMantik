'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { translate } from './t';
import { formatMoneyFromCents } from './currency';
import { formatTimestamp as formatTimestampI18n } from './locale';

interface SiteConfig {
  currency?: string;
  timezone?: string;
}

interface I18nContextValue {
  locale: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  formatMoneyFromCents: (cents: number | null | undefined) => string;
  formatTimestamp: (ts: string | null | undefined, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (n: number) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface I18nProviderProps {
  locale: string;
  siteConfig?: SiteConfig;
  children: React.ReactNode;
}

export function I18nProvider({ locale, siteConfig, children }: I18nProviderProps) {
  const loc = locale || 'en-US';
  const currency = siteConfig?.currency || 'USD';
  const timezone = siteConfig?.timezone || 'UTC';

  const value = useMemo(
    () => ({
      locale: loc,
      t: (key: string, params?: Record<string, string | number>) =>
        translate(key, loc, params),
      formatMoneyFromCents: (cents: number | null | undefined) =>
        formatMoneyFromCents(cents, currency, loc),
      formatTimestamp: (ts: string | null | undefined, options?: Intl.DateTimeFormatOptions) =>
        formatTimestampI18n(ts, timezone, loc, options),
      formatNumber: (n: number) => n.toLocaleString(loc),
    }),
    [loc, currency, timezone]
  );

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18nContext(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      locale: 'en-US',
      t: (key: string) => key,
      formatMoneyFromCents: (c: number | null | undefined) =>
        formatMoneyFromCents(c, 'USD', 'en-US'),
      formatTimestamp: (ts: string | null | undefined, opts?: Intl.DateTimeFormatOptions) =>
        formatTimestampI18n(ts, 'UTC', 'en-US', opts),
      formatNumber: (n: number) => n.toLocaleString('en-US'),
    };
  }
  return ctx;
}
