/**
 * Export Gate — validateExportRow()
 *
 * Pure validation function that determines whether an OCI row is eligible
 * for export to Google Ads, and which click attribution path to use.
 *
 * Attribution Waterfall (per plan):
 *   gclid → wbraid → gbraid → OCT (hashed phone/email) → VOIDED or no-id
 *
 * Returns:
 *   { ok: true, clickSource, clickId } — eligible, proceed with export
 *   { ok: false, reason }             — blocked, log reason and skip
 */

import { calculateDecayDays } from '@/lib/shared/time-utils';
import type { SiteExportConfig, ConversionActionConfig } from './site-export-config';
import type { ClickSource } from './stable-order-id';

// ─────────────────────────────────────────────────────────────────────────────
// Gate Result Types
// ─────────────────────────────────────────────────────────────────────────────

export type ExportGateReason =
  | 'NO_CLICK_ID'          // No gclid/wbraid/gbraid, OCT disabled, require_click_id=true
  | 'OCT_NO_IDENTIFIER'    // OCT enabled but neither hashed_phone nor hashed_email present
  | 'EXPIRED'              // click_date is older than config.max_click_age_days
  | 'ZERO_VALUE'           // value_cents is 0 or negative (Google Ads rejects)
  | 'UNKNOWN_ACTION'       // No conversion_actions entry for this channel×gear
  | 'MIXED_MODE_VIOLATION' // Reserved: value mode changed for existing action

export type ExportGateResult =
  | { ok: true; clickSource: ClickSource; clickId: string }
  | { ok: false; reason: ExportGateReason }

// ─────────────────────────────────────────────────────────────────────────────
// Input Row Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface ExportGateRow {
  /** Row ID — used as clickId in no-id observation mode */
  id: string;
  /** Standard Google Ads click ID */
  gclid?: string | null;
  /** iOS web-to-web click ID (ITP bypass) */
  wbraid?: string | null;
  /** iOS app-to-web click ID (ITP bypass) */
  gbraid?: string | null;
  /** SHA-256 hashed phone number for OCT fallback */
  hashed_phone?: string | null;
  /** SHA-256 hashed email for OCT fallback */
  hashed_email?: string | null;
  /** Calculated conversion value in minor currency units */
  value_cents: number;
  /** Actual click date (session.created_at) — used for expiry check */
  click_date?: Date | null;
  /** Conversion event date */
  signal_date: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate whether an OCI export row is eligible for Google Ads upload.
 *
 * @param row          - The candidate conversion row
 * @param config       - Site-specific export config
 * @param actionConfig - Resolved ConversionActionConfig for this channel×gear (null = not configured)
 * @returns ExportGateResult
 */
export function validateExportRow(
  row: ExportGateRow,
  config: SiteExportConfig,
  actionConfig: ConversionActionConfig | null
): ExportGateResult {

  // ── Step 1: Action must be configured ─────────────────────────────────
  if (!actionConfig) {
    return { ok: false, reason: 'UNKNOWN_ACTION' };
  }

  // ── Step 2: Value must be positive ─────────────────────────────────────
  // Google Ads API and Script both reject value=0.
  // value=null is counted but not used for tROAS optimization.
  if (!row.value_cents || row.value_cents <= 0) {
    return { ok: false, reason: 'ZERO_VALUE' };
  }

  // ── Step 3: Click age expiry check ────────────────────────────────────
  // Google Ads hard limit: 90 days. Rows older than config.max_click_age_days
  // will be silently rejected by Google — we filter them here for clarity.
  if (row.click_date) {
    const days = calculateDecayDays(row.click_date, row.signal_date, 'ceil');
    if (days > config.max_click_age_days) {
      return { ok: false, reason: 'EXPIRED' };
    }
  }

  // ── Step 4: Click Attribution Waterfall ──────────────────────────────
  // Try each click identifier in priority order.
  // gclid: Standard — best match rate, all platforms
  if (row.gclid?.trim()) {
    return { ok: true, clickSource: 'gclid', clickId: row.gclid.trim() };
  }
  // wbraid: iOS Safari web-to-web (Google's ITP workaround, server-side ID)
  if (row.wbraid?.trim()) {
    return { ok: true, clickSource: 'wbraid', clickId: row.wbraid.trim() };
  }
  // gbraid: iOS Safari app-to-web
  if (row.gbraid?.trim()) {
    return { ok: true, clickSource: 'gbraid', clickId: row.gbraid.trim() };
  }

  // ── Step 5: OCT (Enhanced Conversions) Fallback ───────────────────────
  // No click ID found. Try click-less matching via hashed identifier.
  // Google matches the hash to a logged-in Google account.
  const ec = config.enhanced_conversions;
  if (ec.enabled && ec.use_oct_fallback) {
    // Try identifiers in the order specified by config.fallback_identifiers
    for (const identifier of ec.fallback_identifiers) {
      if (identifier === 'hashed_phone' && row.hashed_phone?.trim()) {
        return { ok: true, clickSource: 'oct_phone', clickId: row.hashed_phone.trim() };
      }
      if (identifier === 'hashed_email' && row.hashed_email?.trim()) {
        return { ok: true, clickSource: 'oct_email', clickId: row.hashed_email.trim() };
      }
    }
    // OCT enabled but no identifier found
    return { ok: false, reason: 'OCT_NO_IDENTIFIER' };
  }

  // ── Step 6: require_click_id gate ─────────────────────────────────────
  if (config.require_click_id) {
    return { ok: false, reason: 'NO_CLICK_ID' };
  }

  // ── Step 7: No-ID observation mode ───────────────────────────────────
  // require_click_id=false: allow export without click attribution.
  // Conversion is visible in Google Ads but cannot be matched to a user.
  // Used for observation and volume tracking only.
  return { ok: true, clickSource: 'no_id', clickId: row.id };
}
