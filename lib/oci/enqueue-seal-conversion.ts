/**
 * Seal → OCI Queue Bridge
 *
 * After a call is sealed in War Room, enqueue it for Google Ads OCI if the call
 * has an associated click ID (gclid, wbraid, or gbraid). Uses synthetic value
 * when sale_amount is not provided.
 *
 * Note: conversion_action resource name is resolved at upload time from
 * provider_credentials (conversion_action_resource_name), not from the queue row.
 */

import { adminClient } from '@/lib/supabase/admin';
import { getPrimarySource } from '@/lib/conversation/primary-source';
import { hasMarketingConsentForCall } from '@/lib/gdpr/consent-check';
import { logInfo, logWarn } from '@/lib/logging/logger';

export interface EnqueueSealParams {
  callId: string;
  siteId: string;
  confirmedAt: string;
  saleAmount: number | null;
  currency: string;
  leadScore: number | null;
}

export interface EnqueueSealResult {
  enqueued: boolean;
  reason?: 'no_click_id' | 'duplicate' | 'marketing_consent_required' | 'error';
  error?: string;
}

/** Base value (currency units) for synthetic conversion when sale_amount is missing. */
const SYNTHETIC_BASE_VALUE = 150;

/**
 * Compute value_cents for OCI.
 * - If saleAmount > 0: use saleAmount (assumed in currency units) → cents
 * - Else: Predictive scoring: (lead_score / 20) * SYNTHETIC_BASE_VALUE
 *   lead_score 20 (1 star) → 150, lead_score 100 (5 stars) → 750
 */
function computeValueCents(saleAmount: number | null, leadScore: number | null): number {
  if (saleAmount != null && saleAmount > 0 && Number.isFinite(saleAmount)) {
    return Math.round(saleAmount * 100);
  }
  const score = leadScore != null && Number.isFinite(leadScore) ? Math.max(0, Math.min(100, leadScore)) : 20;
  const syntheticValue = (score / 20) * SYNTHETIC_BASE_VALUE;
  return Math.round(syntheticValue * 100);
}

/**
 * Enqueue a sealed call into offline_conversion_queue for OCI.
 * Skips if no gclid/wbraid/gbraid. Idempotent via UNIQUE(call_id).
 */
export async function enqueueSealConversion(params: EnqueueSealParams): Promise<EnqueueSealResult> {
  const { callId, siteId, confirmedAt, saleAmount, currency, leadScore } = params;

  const primarySource = await getPrimarySource(siteId, { callId });
  const gclid = primarySource?.gclid?.trim() || null;
  const wbraid = primarySource?.wbraid?.trim() || null;
  const gbraid = primarySource?.gbraid?.trim() || null;

  const hasClickId = !!(gclid || wbraid || gbraid);
  if (!hasClickId) {
    logInfo('enqueue_seal_skip', { call_id: callId, reason: 'no_click_id' });
    return { enqueued: false, reason: 'no_click_id' };
  }

  const hasMarketing = await hasMarketingConsentForCall(siteId, callId);
  if (!hasMarketing) {
    logInfo('enqueue_seal_skip', { call_id: callId, reason: 'marketing_consent_required' });
    return { enqueued: false, reason: 'marketing_consent_required' };
  }

  const valueCents = computeValueCents(saleAmount, leadScore);
  const currencySafe = currency?.trim() || 'TRY';

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

    logInfo('enqueue_seal_ok', { call_id: callId, value_cents: valueCents });
    return { enqueued: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn('enqueue_seal_failed', { call_id: callId, error: message });
    return { enqueued: false, reason: 'error', error: message };
  }
}
