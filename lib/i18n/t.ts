/**
 * Lightweight translation — no heavy libs.
 * Fallback: locale exact -> locale prefix (tr-TR -> tr) -> en -> key.
 * Never throws.
 */

import { en } from './messages/en';
import { tr } from './messages/tr';

type Messages = Record<string, string>;
const messages: Record<string, Messages> = {
  en,
  tr,
};

/** Resolve simple param placeholders: {name} -> params.name */
function interpolate(str: string, params?: Record<string, string | number>): string {
  if (!params || typeof params !== 'object') return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k];
    return v != null ? String(v) : `{${k}}`;
  });
}

/**
 * Translate key for locale.
 * Fallback order: exact locale -> locale prefix -> en -> key.
 */
export function translate(
  key: string,
  locale: string,
  params?: Record<string, string | number>
): string {
  try {
    if (!key || typeof key !== 'string') return '';
    const trimmed = key.trim();
    if (!trimmed) return '';

    const exact = messages[locale];
    if (exact && trimmed in exact) {
      return interpolate(String(exact[trimmed]), params);
    }

    const prefix = locale.split('-')[0]?.toLowerCase() || locale.toLowerCase();
    const byPrefix = messages[prefix];
    if (byPrefix && trimmed in byPrefix) {
      return interpolate(String(byPrefix[trimmed]), params);
    }

    if (en[trimmed as keyof typeof en] != null) {
      return interpolate(String(en[trimmed as keyof typeof en]), params);
    }

    return trimmed;
  } catch {
    return key;
  }
}
