/**
 * Type contracts shared between the Google Ads export route and its helper
 * modules. Extracted from app/api/oci/google-ads-export/route.ts during
 * Phase 4 god-object split.
 */

import type { SingleConversionCandidate } from '@/lib/oci/single-conversion-highest-only';

/**
 * Response item shape: matches Google Ads offline conversion expectations.
 * Used by Google Ads Script (UrlFetchApp → parse → AdsApp upload).
 */
export interface GoogleAdsConversionItem {
  /** Queue row id for idempotency / ack. */
  id: string;
  /** Sent as Order ID so Google Ads deduplicates by this value (same orderId → second upload ignored). */
  orderId: string;
  /** Google Click ID (preferred). */
  gclid: string;
  /** iOS web conversions. */
  wbraid: string;
  /** iOS app conversions. */
  gbraid: string;
  /** Conversion action name (e.g. "OpsMantik_Won"). */
  conversionName: string;
  /** Format: yyyy-mm-dd HH:mm:ss±HH:mm (timezone required). Prefer canonical occurred_at. */
  conversionTime: string;
  /** Numeric value only (e.g. 750.00). No currency symbols. */
  conversionValue: number;
  /** ISO-4217 currency code. */
  conversionCurrency: string;
  /** Optional: SHA-256 hex (64 char) for Enhanced Conversions. */
  hashed_phone_number?: string | null;
  /** Phase 20: OM-TRACE-UUID for conversion_custom_variable (forensic chain) */
  om_trace_uuid?: string | null;
  /** Modül 2: primary/secondary role for ROAS inflation logging */
  _role?: 'primary' | 'secondary';
}

/**
 * Modül 1: Adjustment item (RETRACTION / RESTATEMENT)
 * Picked up by Google Ads Script via AdsApp.offlineConversionAdjustments()
 */
export interface GoogleAdsAdjustmentItem {
  /** Adjustment DB id — prefixed adj_ for ACK routing */
  id: string;
  /** Original conversion's orderId (stable — never changes) */
  orderId: string;
  /** Google Ads conversion action name */
  conversionName: string;
  adjustmentType: 'RETRACTION' | 'RESTATEMENT';
  /** ISO timestamp of adjustment */
  adjustmentTime: string;
  /** Only set for RESTATEMENT */
  adjustedValue?: number;
  adjustedCurrency?: string;
}

export type ExportCursorMark = {
  t: string;
  i: string;
};

export type ExportCursorState = {
  q?: ExportCursorMark | null;
  s?: ExportCursorMark | null;
};

export type QueueRow = {
  id: string;
  sale_id?: string | null;
  call_id?: string | null;
  session_id?: string | null;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  conversion_time: string;
  occurred_at?: string | null;
  created_at?: string | null;
  value_cents: number;
  optimization_stage?: string | null;
  optimization_value?: number | null;
  currency?: string | null;
  action?: string | null;
  provider_key?: string | null;
  external_id?: string | null;
};

export type ExportSiteRow = {
  id: string;
  public_id?: string | null;
  currency?: string | null;
  timezone?: string | null;
  oci_sync_method?: string | null;
  oci_api_key?: string | null;
  oci_config?: unknown;
};

export type RankedExportCandidate = SingleConversionCandidate<GoogleAdsConversionItem>;
