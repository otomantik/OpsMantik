/**
 * Single journal writer for non-won OpsMantik stages (contacted / offered / junk).
 * Rows land in `offline_conversion_queue` with deterministic `external_id` — same contract as seal/won.
 *
 * See docs/architecture/EXPORT_CLOSURE.md (S1: journal-only upload surface).
 */

import { adminClient } from '@/lib/supabase/admin';
import { createTenantClient } from '@/lib/supabase/tenant-client';
import { computeOfflineConversionExternalId } from '@/lib/oci/external-id';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';
import { buildOptimizationSnapshot } from '@/lib/oci/optimization-contract';
import type { PipelineStage } from '@/lib/oci/signal-types';
import { loadMarketingSignalEconomics } from '@/lib/oci/marketing-signal-value-ssot';
import { hasMarketingConsentForCall } from '@/lib/gdpr/consent-check';
import { logInfo, logWarn } from '@/lib/logging/logger';
import { parseWithinTemporalSanityWindow } from '@/lib/utils/temporal-sanity';
import { publishToQStash } from '@/lib/ingest/publish';
import { hasAnyClickId } from '@/lib/oci/enqueue-seal-conversion';
import { NEUTRAL_CURRENCY } from '@/lib/i18n/site-locale';

export type EnqueueOciMicroStage = Exclude<PipelineStage, 'won'>;

export interface EnqueueOciConversionRowParams {
  siteId: string;
  callId: string;
  stage: EnqueueOciMicroStage;
  signalDate: Date;
  /** Prefer calls.created_at / intent timestamp for SSOT occurred_at */
  intentCreatedAt?: string | null;
  leadScore: number;
  currency: string;
  sourceOutboxEventId?: string | null;
  gclid: string | null;
  wbraid: string | null;
  gbraid: string | null;
  discoveryMethod?: string | null;
  discoveryConfidence?: number | null;
}

export interface EnqueueOciConversionRowResult {
  enqueued: boolean;
  queueId?: string | null;
  reason?: 'duplicate' | 'CONSENT_MISSING' | 'error';
  error?: string;
}

async function loadSiteOciContext(siteId: string) {
  const { data, error } = await adminClient
    .from('sites')
    .select('currency, oci_sync_method')
    .eq('id', siteId)
    .maybeSingle();

  if (error || !data) {
    logWarn('enqueue_oci_row_config_missing', { site_id: siteId });
    return { siteCurrency: NEUTRAL_CURRENCY, syncMethod: 'script' };
  }

  return {
    siteCurrency: (data as { currency?: string }).currency?.trim() || NEUTRAL_CURRENCY,
    syncMethod: (data as { oci_sync_method?: string }).oci_sync_method || 'script',
  };
}

/**
 * Enqueue contacted / offered / junk into `offline_conversion_queue` (idempotent on active unique index).
 */
export async function enqueueOciConversionRow(
  params: EnqueueOciConversionRowParams
): Promise<EnqueueOciConversionRowResult> {
  const {
    siteId,
    callId,
    stage,
    signalDate,
    intentCreatedAt,
    leadScore,
    currency,
    sourceOutboxEventId,
    gclid,
    wbraid,
    gbraid,
    discoveryMethod,
    discoveryConfidence,
  } = params;

  const hasMarketing = await hasMarketingConsentForCall(siteId, callId);
  if (!hasMarketing) {
    logInfo('enqueue_oci_row_skip', { call_id: callId, stage, reason: 'CONSENT_MISSING' });
    return { enqueued: false, reason: 'CONSENT_MISSING' };
  }

  const { siteCurrency, syncMethod } = await loadSiteOciContext(siteId);
  const currencySafe = currency?.trim() || siteCurrency;

  const snapshot = buildOptimizationSnapshot({
    stage,
    systemScore: leadScore,
    modelVersion: 'universal-value-v1',
  });

  const economics = await loadMarketingSignalEconomics({ siteId, stage, snapshot });
  const valueCents = economics.expectedValueCents;

  const tenantClient = createTenantClient(siteId);
  const { data: callRow } = await tenantClient
    .from('calls')
    .select('matched_session_id, created_at')
    .eq('id', callId)
    .maybeSingle();

  const sessionId = (callRow as { matched_session_id?: string | null } | null)?.matched_session_id ?? null;
  const callCreatedAt = (callRow as { created_at?: string | null } | null)?.created_at ?? null;

  const intentCandidate = intentCreatedAt ?? callCreatedAt ?? null;
  const intentParsed = parseWithinTemporalSanityWindow(intentCandidate);

  let occurredAt: string;
  let sourceTimestamp: string;
  const timeConfidence = 'observed' as const;
  let occurredAtSource: 'intent' | 'legacy_migrated';

  if (intentParsed) {
    occurredAt = intentParsed.toISOString();
    sourceTimestamp = occurredAt;
    occurredAtSource = 'intent';
  } else {
    occurredAt = signalDate.toISOString();
    sourceTimestamp = occurredAt;
    occurredAtSource = 'legacy_migrated';
  }

  const actionName = OPSMANTIK_CONVERSION_NAMES[stage];
  const externalId = computeOfflineConversionExternalId({
    providerKey: 'google_ads',
    action: actionName,
    callId,
    sessionId,
  });

  const hasClick = hasAnyClickId({ gclid, wbraid, gbraid });
  const nowIso = new Date().toISOString();
  let rowStatus: 'QUEUED' | 'BLOCKED_PRECEDING_SIGNALS' = 'QUEUED';
  let rowBlockReason: string | null = null;
  if (!hasClick) {
    rowStatus = 'BLOCKED_PRECEDING_SIGNALS';
    rowBlockReason = 'MISSING_CLICK_ID';
  }

  const insertPayload: Record<string, unknown> = {
    site_id: siteId,
    call_id: callId,
    sale_id: null,
    session_id: sessionId,
    provider_key: 'google_ads',
    external_id: externalId,
    action: actionName,
    conversion_time: occurredAt,
    occurred_at: occurredAt,
    source_timestamp: sourceTimestamp,
    time_confidence: timeConfidence,
    occurred_at_source: occurredAtSource,
    value_cents: valueCents,
    currency: currencySafe,
    value_source: economics.valueSource,
    value_policy_version: economics.policyVersion,
    value_policy_reason: economics.policyReason,
    value_fallback_used: economics.fallbackUsed,
    optimization_stage: snapshot.optimizationStage,
    optimization_stage_base: snapshot.stageBase,
    quality_factor: null,
    optimization_value: snapshot.optimizationValue,
    actual_revenue: snapshot.actualRevenue,
    helper_form_payload: null,
    feature_snapshot: {
      value_policy_version: economics.policyVersion,
      value_policy_reason: economics.policyReason,
      value_source: economics.valueSource,
      enqueue_source: 'enqueue_oci_conversion_row',
      stage,
    },
    outcome_timestamp: occurredAt,
    model_version: snapshot.modelVersion,
    gclid,
    wbraid,
    gbraid,
    status: rowStatus,
    block_reason: rowBlockReason,
    blocked_at: rowStatus === 'BLOCKED_PRECEDING_SIGNALS' ? nowIso : null,
    source_outbox_event_id: sourceOutboxEventId ?? null,
    causal_dna: {},
  };

  if (discoveryMethod) insertPayload.discovery_method = discoveryMethod;
  if (discoveryConfidence != null) insertPayload.discovery_confidence = discoveryConfidence;

  try {
    const { data: inserted, error } = await adminClient
      .from('offline_conversion_queue')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        logInfo('enqueue_oci_row_duplicate', { call_id: callId, stage });
        return { enqueued: false, reason: 'duplicate' };
      }
      logWarn('enqueue_oci_row_failed', { call_id: callId, stage, error: error.message });
      return { enqueued: false, reason: 'error', error: error.message };
    }

    const queueId = (inserted as { id: string } | null)?.id ?? null;

    if (syncMethod === 'api' && rowStatus === 'QUEUED' && queueId) {
      try {
        await publishToQStash({
          lane: 'conversion',
          body: { kind: 'oci_export', queue_id: queueId, site_id: siteId },
          deduplicationId: `oci-micro-fasttrack-${queueId}`,
          retries: 3,
        });
      } catch (publishErr) {
        logWarn('OCI_FASTTRACK_MICRO_FAILED', {
          call_id: callId,
          queue_id: queueId,
          error: publishErr instanceof Error ? publishErr.message : String(publishErr),
        });
      }
    }

    logInfo('enqueue_oci_row_ok', { call_id: callId, stage, queue_id: queueId, action: actionName });
    return { enqueued: true, queueId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn('enqueue_oci_row_failed', { call_id: callId, stage, error: message });
    return { enqueued: false, reason: 'error', error: message };
  }
}
