/**
 * Seal → OCI Queue Bridge
 *
 * After a call is sealed in War Room, enqueue it for Google Ads OCI if the call
 * has an associated click ID (gclid, wbraid, or gbraid).
 *
 * Value logic: V5 is saleAmount when known, otherwise canonical fallbackMinor.
 * Per-site tuning is handled by SiteExportConfig + ValueConfig fallback policy.
 */

import { createTenantClient } from '@/lib/supabase/tenant-client';
import { adminClient } from '@/lib/supabase/admin';
import { getPrimarySource } from '@/lib/conversation/primary-source';
import { getPrimarySourceWithDiscovery } from '@/lib/oci/identity-stitcher';
import { hasMarketingConsentForCall } from '@/lib/gdpr/consent-check';
import { logInfo, logWarn } from '@/lib/logging/logger';
import { computeOfflineConversionExternalId } from '@/lib/oci/external-id';
import { buildMinimalCausalDna } from '@/lib/domain/mizan-mantik/causal-dna';
import { appendCausalDnaLedgerSafe } from '@/lib/domain/mizan-mantik/shared';
import { resolveSealOccurredAt } from '@/lib/oci/occurred-at';
import { appendFunnelEvent } from '@/lib/domain/funnel-kernel/ledger-writer';
import { publishToQStash } from '@/lib/ingest/publish';
import {
  buildOptimizationSnapshot,
  type HelperFormPayload,
} from '@/lib/oci/optimization-contract';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/domain/mizan-mantik/conversion-names';
import { NEUTRAL_CURRENCY } from '@/lib/i18n/site-locale';

export interface EnqueueSealParams {
  callId: string;
  siteId: string;
  confirmedAt: string;
  saleOccurredAt?: string | null;
  saleAmount: number | null;
  currency: string;
  leadScore: number | null;
  entryReason?: string | null;
  helperFormPayload?: HelperFormPayload | null;
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
  | 'error';
  value?: number;
  usedFallback?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Site OCI config loader
// ---------------------------------------------------------------------------

async function loadSiteOciContext(siteId: string) {
  const { data, error } = await adminClient
    .from('sites')
    .select('currency, oci_sync_method')
    .eq('id', siteId)
    .maybeSingle();

  if (error || !data) {
    logWarn('enqueue_seal_config_missing', { site_id: siteId });
    return { siteCurrency: NEUTRAL_CURRENCY, syncMethod: 'script' };
  }

  return {
    siteCurrency: (data as { currency?: string }).currency?.trim() || NEUTRAL_CURRENCY,
    syncMethod: (data as { oci_sync_method?: string }).oci_sync_method || 'script',
  };
}

// ---------------------------------------------------------------------------
// Main enqueue function
// ---------------------------------------------------------------------------

/**
 * Enqueue a sealed call into offline_conversion_queue for OCI.
 * Skips only for attribution/consent failures. Value is sale or canonical fallback.
 * Idempotent via UNIQUE(call_id).
 */
export async function enqueueSealConversion(params: EnqueueSealParams): Promise<EnqueueSealResult> {
  const { callId, siteId, confirmedAt, saleOccurredAt, saleAmount, currency, leadScore, entryReason, helperFormPayload } = params;

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
  const occurredAtMeta = resolveSealOccurredAt({
    saleOccurredAt,
    fallbackConfirmedAt: confirmedAtTrimmed,
  });

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

  // 3. Load site OCI context (currency/sync only)
  const { siteCurrency, syncMethod } = await loadSiteOciContext(siteId);

  const currencySafe = currency?.trim() || siteCurrency;
  const optimizationSnapshot = buildOptimizationSnapshot({
    stage: 'won',
    systemScore: leadScore,
    actualRevenue: saleAmount,
    helperFormPayload: helperFormPayload ?? null,
  });
  const valueUnits = optimizationSnapshot.optimizationValue;
  const valueCents = Math.max(Math.round(valueUnits * 100), 1);
  const usedFallback = !(saleAmount != null && Number.isFinite(saleAmount) && saleAmount > 0);

  if (usedFallback) {
    logInfo('enqueue_seal_missing_actual_revenue', {
      call_id: callId,
      lead_score: leadScore,
      optimization_value_cents: valueCents,
    });
  }

  // 6. Resolve session_id for attribution — deduplication is enforced by the DB unique index
  // on (site_id, provider_key, external_id), NOT by an application-layer pre-check.
  // A pre-check is a TOCTOU race: two concurrent workers can both pass the check and both
  // attempt the insert; the second will get a 23505 which is caught below.
  const tenantClient = createTenantClient(siteId);
  let sessionId: string | null = null;
  const { data: callRow } = await tenantClient
    .from('calls')
    .select('matched_session_id')
    .eq('id', callId)
    .maybeSingle();
  sessionId = (callRow as { matched_session_id?: string | null } | null)?.matched_session_id ?? null;

  // 7. Causal DNA for Seal path (Singularity)
  const causalDna = buildMinimalCausalDna(
    'won',
    ['auth', 'consent', 'idempotency', 'usage'],
    'Seal_Conversion',
    { saleAmount, valueUnits, usedFallback },
    { valueCents, currency: currencySafe, fallbackApplied: usedFallback }
  );

  // 8. Insert into queue. Keep legacy conversion_time populated for compatibility,
  // but canonical export should prefer occurred_at.
  try {
    const insertPayload: Record<string, unknown> = {
      site_id: siteId,
      call_id: callId,
      sale_id: null,
      session_id: sessionId,
      provider_key: 'google_ads',
      external_id: computeOfflineConversionExternalId({
        providerKey: 'google_ads',
        action: OPSMANTIK_CONVERSION_NAMES.won,
        callId,
        sessionId,
      }),
      action: OPSMANTIK_CONVERSION_NAMES.won,
      conversion_time: occurredAtMeta.occurredAt,
      occurred_at: occurredAtMeta.occurredAt,
      source_timestamp: occurredAtMeta.sourceTimestamp,
      time_confidence: occurredAtMeta.timeConfidence,
      occurred_at_source: occurredAtMeta.occurredAtSource,
      value_cents: valueCents,
      currency: currencySafe,
      optimization_stage: optimizationSnapshot.optimizationStage,
      optimization_stage_base: optimizationSnapshot.stageBase,
      system_score: optimizationSnapshot.systemScore,
      quality_factor: optimizationSnapshot.qualityFactor,
      optimization_value: optimizationSnapshot.optimizationValue,
      actual_revenue: optimizationSnapshot.actualRevenue,
      helper_form_payload: optimizationSnapshot.helperFormPayload,
      feature_snapshot: {
        discovery_method: discoveryMethod,
        discovery_confidence: discoveryConfidence,
        has_gclid: Boolean(gclid),
        has_wbraid: Boolean(wbraid),
        has_gbraid: Boolean(gbraid),
      },
      outcome_timestamp: occurredAtMeta.occurredAt,
      model_version: optimizationSnapshot.modelVersion,
      gclid,
      wbraid,
      gbraid,
      status: 'QUEUED',
      causal_dna: causalDna,
      entropy_score: 0,
      uncertainty_bit: false,
    };
    if (entryReason?.trim()) insertPayload.entry_reason = entryReason.trim().slice(0, 500);
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
        return { enqueued: false, reason: 'duplicate', usedFallback };
      }
      logWarn('enqueue_seal_failed', { call_id: callId, error: error.message });
      return { enqueued: false, reason: 'error', error: error.message, usedFallback };
    }

    const queueId = (inserted as { id: string } | null)?.id ?? null;
    if (queueId) {
      appendCausalDnaLedgerSafe(siteId, 'conversion', queueId, causalDna);
      try {
        await appendFunnelEvent({
          callId,
          siteId,
          eventType: 'won',
          eventSource: 'SEAL_ROUTE',
          idempotencyKey: `won:call:${callId}`,
          occurredAt: new Date(occurredAtMeta.occurredAt),
          payload: { value_cents: valueCents, currency: currencySafe },
        });
      } catch (ledgerErr) {
        logWarn('FUNNEL_LEDGER_WON_APPEND_FAILED', { call_id: callId, queue_id: queueId, error: (ledgerErr as Error)?.message });
      }
    }

    logInfo('enqueue_seal_ok', {
      call_id: callId,
      queue_id: queueId,
      value_units: valueUnits,
      value_cents: valueCents,
      used_fallback: usedFallback,
    });

    // 9. Fast-Track: Trigger immediate Value-Lane synchronization
    // Only trigger if site is in 'api' mode. 'script' sites must wait for polling.
    if (syncMethod === 'api') {
        try {
            await publishToQStash({
                lane: 'conversion',
                body: { kind: 'oci_export', queue_id: queueId, site_id: siteId },
                deduplicationId: `oci-v5-fasttrack-${queueId}`,
                retries: 3,
            });
        } catch (publishErr) {
            logWarn('OCI_FASTTRACK_TRIGGER_FAILED', {
                call_id: callId,
                queue_id: queueId,
                error: (publishErr as Error)?.message ?? String(publishErr)
            });
        }
    }

    return { enqueued: true, queueId, value: valueUnits ?? 0, usedFallback };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn('enqueue_seal_failed', { call_id: callId, error: message });
    return { enqueued: false, reason: 'error', error: message };
  }
}
