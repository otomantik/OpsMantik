/**
 * Seal → OCI Queue Bridge (Sprint 1.6b: per-site OCI config)
 *
 * After a call is sealed in War Room, enqueue it for Google Ads OCI if the call
 * has an associated click ID (gclid, wbraid, or gbraid).
 *
 * Value logic (per-site configurable via sites.oci_config):
 *   - If operator entered sale_amount → use it directly (ground truth)
 *   - If star < site.oci_config.min_star → skip (don't pollute Google's model)
 *   - Otherwise → base_value × weights[star]
 *
 * Default config (when site has none):
 *   base_value=500 TRY, min_star=3, weights={3:0.5, 4:0.8, 5:1.0}
 */

import { adminClient } from '@/lib/supabase/admin';
import { getPrimarySource } from '@/lib/conversation/primary-source';
import { hasMarketingConsentForCall } from '@/lib/gdpr/consent-check';
import { logInfo, logWarn } from '@/lib/logging/logger';
import { parseOciConfig, computeConversionValue } from '@/lib/oci/oci-config';

export interface EnqueueSealParams {
  callId: string;
  siteId: string;
  confirmedAt: string;
  saleAmount: number | null;
  currency: string;
  leadScore: number | null;
  /** Raw star rating (1-5). Used for value calculation. */
  star?: number | null;
}

export interface EnqueueSealResult {
  enqueued: boolean;
  reason?: 'no_click_id' | 'duplicate' | 'marketing_consent_required' | 'star_below_threshold' | 'error';
  value?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Site OCI config loader
// ---------------------------------------------------------------------------

async function loadSiteOciConfig(siteId: string) {
  const { data, error } = await adminClient
    .from('sites')
    .select('oci_config, currency')
    .eq('id', siteId)
    .maybeSingle();

  if (error || !data) {
    logWarn('enqueue_seal_config_missing', { site_id: siteId });
    return { config: parseOciConfig(null), siteCurrency: 'TRY' };
  }

  return {
    config: parseOciConfig((data as { oci_config?: unknown }).oci_config),
    siteCurrency: (data as { currency?: string }).currency?.trim() || 'TRY',
  };
}

// ---------------------------------------------------------------------------
// Legacy lead_score → star converter (backward compat)
// lead_score: 0-100 scale where 20 = 1 star, 40 = 2 stars, …, 100 = 5 stars
// ---------------------------------------------------------------------------

function leadScoreToStar(leadScore: number | null): number | null {
  if (leadScore == null || !Number.isFinite(leadScore)) return null;
  const clamped = Math.max(0, Math.min(100, leadScore));
  return Math.round(clamped / 20);
}

// ---------------------------------------------------------------------------
// Main enqueue function
// ---------------------------------------------------------------------------

/**
 * Enqueue a sealed call into offline_conversion_queue for OCI.
 * Skips if no gclid/wbraid/gbraid, marketing consent absent, or star below threshold.
 * Idempotent via UNIQUE(call_id).
 */
export async function enqueueSealConversion(params: EnqueueSealParams): Promise<EnqueueSealResult> {
  const { callId, siteId, confirmedAt, saleAmount, currency, leadScore, star: starParam } = params;

  // 1. Click ID check
  const primarySource = await getPrimarySource(siteId, { callId });
  const gclid = primarySource?.gclid?.trim() || null;
  const wbraid = primarySource?.wbraid?.trim() || null;
  const gbraid = primarySource?.gbraid?.trim() || null;

  if (!gclid && !wbraid && !gbraid) {
    logInfo('enqueue_seal_skip', { call_id: callId, reason: 'no_click_id' });
    return { enqueued: false, reason: 'no_click_id' };
  }

  // 2. Marketing consent check
  const hasMarketing = await hasMarketingConsentForCall(siteId, callId);
  if (!hasMarketing) {
    logInfo('enqueue_seal_skip', { call_id: callId, reason: 'marketing_consent_required' });
    return { enqueued: false, reason: 'marketing_consent_required' };
  }

  // 3. Load site OCI config
  const { config, siteCurrency } = await loadSiteOciConfig(siteId);

  // 4. Resolve star rating
  //    Prefer explicit star param; fall back to lead_score conversion
  const star = starParam ?? leadScoreToStar(leadScore);

  // 5. Compute conversion value
  const valueUnits = computeConversionValue(star, saleAmount, config);

  if (valueUnits === null) {
    // null → star below threshold (or no star available)
    logInfo('enqueue_seal_skip', {
      call_id: callId,
      reason: 'star_below_threshold',
      star,
      min_star: config.min_star,
    });
    return { enqueued: false, reason: 'star_below_threshold' };
  }

  const valueCents = Math.round(valueUnits * 100);
  const currencySafe = currency?.trim() || config.currency || siteCurrency;

  // 6. Insert into queue
  try {
    const { error } = await adminClient.from('offline_conversion_queue').insert({
      site_id: siteId,
      call_id: callId,
      sale_id: null,
      provider_key: 'google_ads',
      conversion_time: confirmedAt,
      value_cents: valueCents,
      currency: currencySafe,
      gclid,
      wbraid,
      gbraid,
      status: 'QUEUED',
    });

    if (error) {
      if (error.code === '23505') {
        logInfo('enqueue_seal_skip', { call_id: callId, reason: 'duplicate' });
        return { enqueued: false, reason: 'duplicate' };
      }
      logWarn('enqueue_seal_failed', { call_id: callId, error: error.message });
      return { enqueued: false, reason: 'error', error: error.message };
    }

    logInfo('enqueue_seal_ok', { call_id: callId, star, value_units: valueUnits, value_cents: valueCents });
    return { enqueued: true, value: valueUnits };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn('enqueue_seal_failed', { call_id: callId, error: message });
    return { enqueued: false, reason: 'error', error: message };
  }
}
