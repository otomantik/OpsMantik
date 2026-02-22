'use client';

import { useI18nContext } from './I18nProvider';

/**
 * Hook for translation and formatting inside I18nProvider.
 * Returns t, locale, formatMoneyFromCents, formatTimestamp, formatNumber.
 */
export function useTranslation() {
  return useI18nContext();
}
