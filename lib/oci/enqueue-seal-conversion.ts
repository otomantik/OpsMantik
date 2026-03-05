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

import { createTenantClient } from '@/lib/supabase/tenant-client';
import { adminClient } from '@/lib/supabase/admin';
import { getPrimarySource } from '@/lib/conversation/primary-source';
import { getPrimarySourceWithDiscovery } from '@/lib/oci/identity-stitcher';
import { hasMarketingConsentForCall } from '@/lib/gdpr/consent-check';
import { logInfo, logWarn } from '@/lib/logging/logger';
import { parseOciConfig, computeConversionValue } from '@/lib/oci/oci-config';
import { leadScoreToStar } from '@/lib/domain/mizan-mantik/score';
import { buildMinimalCausalDna } from '@/lib/domain/mizan-mantik/causal-dna';

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
  /** Queue row id when enqueued (for Fast-Track trigger) */
  queueId?: string | null;
  reason?:
  | 'no_click_id'
  | 'duplicate'
  | 'duplicate_session'
  | 'marketing_consent_required'
  | 'star_below_threshold'
  | 'no_sale_amount'
  | 'error';
  value?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Site OCI config loader
// ---------------------------------------------------------------------------

async function loadSiteOciConfig(siteId: string) {
  const { data, error } = await adminClient
    .from('sites')
    .select('oci_config, currency, default_aov')
    .eq('id', siteId)
    .maybeSingle();

  if (error || !data) {
    logWarn('enqueue_seal_config_missing', { site_id: siteId });
    return { config: parseOciConfig(null), siteCurrency: 'TRY' };
  }

  const defaultAov = (data as { default_aov?: number | null }).default_aov;
  return {
    config: parseOciConfig((data as { oci_config?: unknown }).oci_config, defaultAov),
    siteCurrency: (data as { currency?: string }).currency?.trim() || 'TRY',
  };
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

  // 0. Null safety: Seal requires confirmed_at — never send broken payload to Google
  if (!confirmedAt || typeof confirmedAt !== 'string') {
    logWarn('enqueue_seal_rejected', {
      call_id: callId,
      reason: 'OCI_SEAL_CONFIRMED_AT_REQUIRED',
      detail: 'confirmedAt must be non-null UTC/ISO string',
    });
    return { enqueued: false, reason: 'error', error: 'OCI_SEAL_CONFIRMED_AT_REQUIRED' };
  }
  const confirmedAtTrimmed = confirmedAt.trim();
  if (!confirmedAtTrimmed) {
    logWarn('enqueue_seal_rejected', { call_id: callId, reason: 'OCI_SEAL_CONFIRMED_AT_REQUIRED' });
    return { enqueued: false, reason: 'error', error: 'OCI_SEAL_CONFIRMED_AT_REQUIRED' };
  }
  const parsedDate = new Date(confirmedAtTrimmed);
  if (Number.isNaN(parsedDate.getTime())) {
    logWarn('enqueue_seal_rejected', {
      call_id: callId,
      reason: 'OCI_SEAL_CONFIRMED_AT_INVALID',
      detail: 'confirmedAt must be parseable UTC/ISO',
    });
    return { enqueued: false, reason: 'error', error: 'OCI_SEAL_CONFIRMED_AT_INVALID' };
  }
  const { isWithinTemporalSanityWindow } = await import('@/lib/utils/temporal-sanity');
  if (!isWithinTemporalSanityWindow(parsedDate)) {
    logWarn('enqueue_seal_rejected', {
      call_id: callId,
      reason: 'OCI_SEAL_TEMPORAL_POISONING',
      detail: 'confirmedAt outside [now - 90 days, now + 1 hour]',
    });
    return { enqueued: false, reason: 'error', error: 'OCI_SEAL_TEMPORAL_POISONING' };
  }

  // 1. Click ID check (with Identity Stitcher: DIRECT → PHONE_STITCH → FINGERPRINT_STITCH)
  const directSource = await getPrimarySource(siteId, { callId });
  const { data: callCtx } = await adminClient
    .from('calls')
    .select('caller_phone_e164, matched_fingerprint, confirmed_at, created_at')
    .eq('id', callId)
    .eq('site_id', siteId)
    .maybeSingle();

  const callTime = (callCtx as { confirmed_at?: string; created_at?: string } | null)?.confirmed_at
    ?? (callCtx as { created_at?: string } | null)?.created_at
    ?? confirmedAtTrimmed;
  const discovered = await getPrimarySourceWithDiscovery(siteId, directSource, {
    callId,
    callTime,
    callerPhoneE164: (callCtx as { caller_phone_e164?: string | null } | null)?.caller_phone_e164 ?? null,
    fingerprint: (callCtx as { matched_fingerprint?: string | null } | null)?.matched_fingerprint ?? null,
  });

  const gclid = discovered?.source?.gclid?.trim() || null;
  const wbraid = discovered?.source?.wbraid?.trim() || null;
  const gbraid = discovered?.source?.gbraid?.trim() || null;
  const discoveryMethod = discovered?.discoveryMethod ?? null;
  const discoveryConfidence = discovered?.discoveryConfidence ?? null;

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
  const valueUnits = computeConversionValue(star, saleAmount);

  if (valueUnits === null) {
    const noSale = saleAmount == null || saleAmount === 0;
    logInfo('enqueue_seal_skip', {
      call_id: callId,
      reason: noSale ? 'no_sale_amount' : 'star_below_threshold',
      star,
      min_star: config.min_star,
    });
    return { enqueued: false, reason: noSale ? 'no_sale_amount' : 'star_below_threshold' };
  }

  const valueCents = Math.round(valueUnits * 100);
  const currencySafe = currency?.trim() || config.currency || siteCurrency;

  // 6. Resolve session_id and enforce 1 conversion per session (dedupe before insert)
  const tenantClient = createTenantClient(siteId);
  let sessionId: string | null = null;
  const { data: callRow } = await tenantClient
    .from('calls')
    .select('matched_session_id')
    .eq('id', callId)
    .maybeSingle();
  sessionId = (callRow as { matched_session_id?: string | null } | null)?.matched_session_id ?? null;

  if (sessionId) {
    const { data: existingList } = await adminClient
      .from('offline_conversion_queue')
      .select('id')
      .eq('site_id', siteId)
      .eq('session_id', sessionId)
      .in('status', ['QUEUED', 'RETRY', 'PROCESSING'])
      .limit(1);
    const existing = Array.isArray(existingList) ? existingList[0] : null;
    if (existing) {
      logInfo('enqueue_seal_skip', { call_id: callId, reason: 'duplicate_session', session_id: sessionId });
      return { enqueued: false, reason: 'duplicate_session' };
    }
  }

  // 7. Causal DNA for Seal path (Singularity)
  const causalDna = buildMinimalCausalDna(
    'V5_SEAL',
    ['auth', 'consent', 'idempotency', 'usage'],
    'Seal_Conversion',
    { star, saleAmount, valueUnits },
    { valueCents, currency: currencySafe }
  );

  // 8. Insert into queue (Seal: conversion_time = confirmed_at, UTC/ISO; DB stores timestamptz)
  try {
    const insertPayload: Record<string, unknown> = {
      site_id: siteId,
      call_id: callId,
      sale_id: null,
      session_id: sessionId,
      provider_key: 'google_ads',
      conversion_time: confirmedAtTrimmed,
      value_cents: valueCents,
      currency: currencySafe,
      gclid,
      wbraid,
      gbraid,
      status: 'QUEUED',
      causal_dna: causalDna,
      entropy_score: 0,
      uncertainty_bit: false,
    };
    if (discoveryMethod) insertPayload.discovery_method = discoveryMethod;
    if (discoveryConfidence != null) insertPayload.discovery_confidence = discoveryConfidence;

    const { data: inserted, error } = await adminClient
      .from('offline_conversion_queue')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        logInfo('enqueue_seal_skip', { call_id: callId, reason: 'duplicate' });
        return { enqueued: false, reason: 'duplicate' };
      }
      logWarn('enqueue_seal_failed', { call_id: callId, error: error.message });
      return { enqueued: false, reason: 'error', error: error.message };
    }

    const queueId = (inserted as { id: string } | null)?.id ?? null;
    if (queueId) {
      void adminClient
        .rpc('append_causal_dna_ledger', {
          p_site_id: siteId,
          p_aggregate_type: 'conversion',
          p_aggregate_id: queueId,
          p_causal_dna: causalDna,
        })
        .then(() => { }, () => { });
    }

    logInfo('enqueue_seal_ok', { call_id: callId, queue_id: queueId, star, value_units: valueUnits, value_cents: valueCents });
    return { enqueued: true, queueId, value: valueUnits };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn('enqueue_seal_failed', { call_id: callId, error: message });
    return { enqueued: false, reason: 'error', error: message };
  }
}
