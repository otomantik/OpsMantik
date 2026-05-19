/**
 * Single journal writer for non-won OpsMantik stages (contacted / offered / junk).
 * Rows land in `offline_conversion_queue` with deterministic `external_id` — same contract as seal/won.
 *
 * See docs/architecture/EXPORT_CLOSURE.md (S1: journal-only upload surface).
 */

import { createTenantClient } from '@/lib/supabase/tenant-client';
import { computeOfflineConversionExternalId } from '@/lib/oci/external-id';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';
import { buildOptimizationSnapshot } from '@/lib/oci/optimization-contract';
import type { PipelineStage } from '@/lib/oci/signal-types';
import { loadOciConversionEconomics } from '@/lib/oci/oci-conversion-economics';
import { hasMarketingConsentForCall } from '@/lib/gdpr/consent-check';
import { logInfo, logWarn } from '@/lib/logging/logger';
import { parseWithinTemporalSanityWindow } from '@/lib/utils/temporal-sanity';
import { NEUTRAL_CURRENCY } from '@/lib/i18n/site-locale';
import { adminClient } from '@/lib/supabase/admin';
import { optimizationStageToIntentStage } from '@/lib/oci/intent-conversion-journal-contract';
import { enqueueIntentConversionJournalRow } from '@/lib/oci/enqueue-intent-conversion-journal-row';

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
  /** Optional journal provenance (defaults to `enqueue_oci_conversion_row`). */
  journalSourceType?: string | null;
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
    journalSourceType,
  } = params;

  const hasMarketing = await hasMarketingConsentForCall(siteId, callId);
  if (!hasMarketing) {
    logInfo('enqueue_oci_row_consent_skip_logged', { call_id: callId, stage, reason: 'CONSENT_MISSING' });
  }

  const { siteCurrency, syncMethod } = await loadSiteOciContext(siteId);
  const currencySafe = currency?.trim() || siteCurrency;

  const snapshot = buildOptimizationSnapshot({
    stage,
    systemScore: leadScore,
    modelVersion: 'universal-value-v1',
  });

  const economics = await loadOciConversionEconomics({ siteId, stage, snapshot });
  const valueCents = economics.expectedValueCents;

  const tenantClient = createTenantClient(siteId);
  const { data: callRow } = await tenantClient
    .from('calls')
    .select('matched_session_id, created_at, caller_phone_hash_sha256')
    .eq('id', callId)
    .maybeSingle();

  const sessionId = (callRow as { matched_session_id?: string | null } | null)?.matched_session_id ?? null;
  const callCreatedAt = (callRow as { created_at?: string | null } | null)?.created_at ?? null;
  const callerPhoneHashSha256 =
    (callRow as { caller_phone_hash_sha256?: string | null } | null)?.caller_phone_hash_sha256 ?? null;

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

  const intentStage = optimizationStageToIntentStage(stage);

  const journalResult = await enqueueIntentConversionJournalRow({
    siteId,
    providerKey: 'google_ads',
    callId,
    sessionId,
    saleId: null,
    stage: intentStage,
    conversionName: actionName,
    externalId,
    conversionTime: occurredAt,
    occurredAt,
    sourceTimestamp,
    timeConfidence,
    occurredAtSource,
    valueCents,
    currency: currencySafe,
    valueSource: economics.valueSource,
    valuePolicyVersion: economics.policyVersion,
    valuePolicyReason: economics.policyReason,
    valueFallbackUsed: economics.fallbackUsed,
    optimizationStage: snapshot.optimizationStage,
    optimizationStageBase: snapshot.stageBase,
    optimizationValue: snapshot.optimizationValue,
    actualRevenue: snapshot.actualRevenue,
    modelVersion: snapshot.modelVersion,
    gclid,
    wbraid,
    gbraid,
    consentMarketing: hasMarketing,
    consentUserIdentifiers: hasMarketing,
    sendabilityOk: true,
    ociSyncMethod: syncMethod,
    sourceOutboxEventId,
    sourceType: journalSourceType ?? 'enqueue_oci_conversion_row',
    sourceIdempotencyKey: externalId,
    discoveryMethod,
    discoveryConfidence,
    callCallerPhoneHashSha256: callerPhoneHashSha256,
    featureSnapshot: {
      value_policy_version: economics.policyVersion,
      value_policy_reason: economics.policyReason,
      value_source: economics.valueSource,
      stage,
    },
  });

  return {
    enqueued: journalResult.enqueued,
    queueId: journalResult.queueId,
    reason: journalResult.reason,
    error: journalResult.error,
  };
}
