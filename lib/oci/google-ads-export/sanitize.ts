/**
 * Low-level sanitizers for the Google Ads export route output shape.
 * Extracted from app/api/oci/google-ads-export/route.ts during Phase 4
 * god-object split.
 */

import { NEUTRAL_CURRENCY } from '@/lib/i18n/site-locale';
import type { ExportCursorMark } from './types';

/** Ensure value is a number suitable for conversion value (no currency symbols). Round to 2 decimals. */
export function ensureNumericValue(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/** Ensure currency is a clean ISO-4217 code. Strip non-alpha, fall back to neutral USD. */
export function ensureCurrencyCode(raw: string): string {
  const code = String(raw || NEUTRAL_CURRENCY).trim().toUpperCase().replace(/[^A-Z]/g, '');
  return code || NEUTRAL_CURRENCY;
}

export function readExportCursorMark(value: unknown): ExportCursorMark | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { t?: unknown; i?: unknown };
  if (typeof row.t !== 'string' || typeof row.i !== 'string' || !row.t || !row.i) return null;
  return { t: row.t, i: row.i };
}
