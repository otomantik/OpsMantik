/**
 * PR-9H.6 — Single enqueue surface for intent stages → offline_conversion_queue (journal SSOT).
 * Does not upload, ACK, or write marketing_signals upload authority.
 */

import { adminClient } from '@/lib/supabase/admin';
import { logInfo, logWarn } from '@/lib/logging/logger';
import { publishToQStash } from '@/lib/ingest/publish';
import {
  defaultProviderPathFromSyncMethod,
  type GoogleAdsProviderPath,
  type IntentJournalStage,
  type UserIdentifiersPayload,
  type PrecomputedJournalDispositionInput,
  resolveQueueJournalDisposition,
} from '@/lib/oci/intent-conversion-journal-contract';
import { buildGoogleAdsUserIdentifiers } from '@/lib/oci/google-ads-user-identifier-normalization';
import {
  EC_PHONE_HASH_NORMALIZATION_VERSION,
  isSha256Hex,
} from '@/lib/oci/validation/crypto';

function mergeVerifiedCallerPhoneHashIntoUserIdentifiers(
  payload: UserIdentifiersPayload | null,
  verified: string | null | undefined
): UserIdentifiersPayload | null {
  const h =
    typeof verified === 'string' && verified.trim() && isSha256Hex(verified.trim())
      ? verified.trim().toLowerCase()
      : null;
  if (!h) return payload;

  const existingPhone = payload?.hashed_phone?.trim().toLowerCase();
  if (existingPhone && existingPhone !== h) return payload;

  const base: UserIdentifiersPayload =
    payload ??
    ({
      normalization_version: EC_PHONE_HASH_NORMALIZATION_VERSION,
    } as UserIdentifiersPayload);

  return {
    ...base,
    hashed_phone: existingPhone ?? h,
    normalization_version: EC_PHONE_HASH_NORMALIZATION_VERSION,
    source: base.source ?? 'caller_phone_hash_sha256',
  };
}

export type EnqueueIntentConversionJournalRowInput = {
  siteId: string;
  providerKey: string;
  callId: string;
  sessionId: string | null;
  saleId: string | null;
  stage: IntentJournalStage;
  /** Must match stage; caller supplies resolved OpsMantik_* name */
  conversionName: string;
  externalId: string;
  conversionTime: string;
  occurredAt: string;
  sourceTimestamp: string;
  timeConfidence: string;
  occurredAtSource: string;
  valueCents: number;
  currency: string;
  valueSource: string;
  valuePolicyVersion: string | null;
  valuePolicyReason: string | null;
  valueFallbackUsed: boolean;
  optimizationStage: string;
  optimizationStageBase: number | null;
  optimizationValue: number | null;
  actualRevenue: number | null;
  modelVersion: string | null;
  gclid: string | null;
  wbraid: string | null;
  gbraid: string | null;
  consentMarketing: boolean;
  /** When false, hashed identifiers are not built even if raw PII is passed */
  consentUserIdentifiers?: boolean;
  /** Call / OCI sendability gate (micro-stages default true) */
  sendabilityOk?: boolean;
  rawEmail?: string | null;
  rawPhone?: string | null;
  defaultCountryCallingCode?: string;
  ociSyncMethod?: string | null;
  providerPathOverride?: GoogleAdsProviderPath;
  sourceOutboxEventId?: string | null;
  sourceType?: string | null;
  sourceIdempotencyKey?: string | null;
  discoveryMethod?: string | null;
  discoveryConfidence?: number | null;
  /** Optional funnel / ops attribution (stored on queue row entry_reason column). */
  entryReason?: string | null;
  featureSnapshot?: Record<string, unknown>;
  /**
   * When set (won/seal path), skips automated `resolveQueueJournalDisposition`
   * and optional user-hash build — caller owns queue status semantics.
   */
  precomputedDisposition?: PrecomputedJournalDispositionInput | null;
  /** When precomputed disposition is absent, merges with derived user identifiers JSON. */
  userIdentifiersExplicit?: UserIdentifiersPayload | null;
  /** `seal_fasttrack`: publish dedupe id `oci-v5-fasttrack-${queueId}` (legacy seal); default `oci-intent-journal-${queueId}`. */
  fastTrackDedupeLabel?: 'seal_fasttrack' | 'intent_journal';
  /** Verified 64-char hex from `calls.caller_phone_hash_sha256` — never raw phone (PR-9H.7A). */
  callCallerPhoneHashSha256?: string | null;
};

export type EnqueueIntentConversionJournalRowResult = {
  enqueued: boolean;
  queueId?: string | null;
  reason?: 'duplicate' | 'CONSENT_MISSING' | 'error';
  error?: string;
  dispositionClassification?: string;
};

export async function enqueueIntentConversionJournalRow(
  input: EnqueueIntentConversionJournalRowInput
): Promise<EnqueueIntentConversionJournalRowResult> {
  const providerPath =
    input.providerPathOverride ?? defaultProviderPathFromSyncMethod(input.ociSyncMethod);

  const consentUserIdentifiers = input.consentUserIdentifiers ?? input.consentMarketing;
  const sendabilityOk = input.sendabilityOk !== false;

  let userIdentifiersPayload: UserIdentifiersPayload | null = null;

  if (input.precomputedDisposition) {
    userIdentifiersPayload = input.userIdentifiersExplicit ?? null;
  } else {
    const built = buildGoogleAdsUserIdentifiers({
      email: input.rawEmail ?? null,
      phone: input.rawPhone ?? null,
      defaultCountryCallingCode: input.defaultCountryCallingCode,
      consentUserIdentifiers,
    });
    userIdentifiersPayload = built.userIdentifiers
      ? {
          hashed_email: built.userIdentifiers.hashed_email,
          hashed_phone: built.userIdentifiers.hashed_phone,
          normalization_version: built.userIdentifiers.normalization_version,
          consent: built.userIdentifiers.consent,
        }
      : null;
    if (input.userIdentifiersExplicit) {
      userIdentifiersPayload = input.userIdentifiersExplicit;
    }
  }

  userIdentifiersPayload = mergeVerifiedCallerPhoneHashIntoUserIdentifiers(
    userIdentifiersPayload,
    input.callCallerPhoneHashSha256
  );

  const nowIso = new Date().toISOString();
  const disposition = input.precomputedDisposition
    ? {
        ...input.precomputedDisposition,
      }
    : resolveQueueJournalDisposition({
        providerPath,
        consentMarketing: input.consentMarketing,
        consentUserIdentifiers,
        sendabilityOk,
        gclid: input.gclid,
        wbraid: input.wbraid,
        gbraid: input.gbraid,
        userIdentifiers: userIdentifiersPayload,
        nowIso,
      });

  const featureSnapshot = {
    ...input.featureSnapshot,
    enqueue_source: 'enqueue_intent_conversion_journal_row',
    intent_journal_stage: input.stage,
    provider_path: providerPath,
    journal_classification: disposition.classification,
    user_identifier_normalization: userIdentifiersPayload?.normalization_version ?? null,
    has_user_identifiers: Boolean(userIdentifiersPayload?.hashed_email || userIdentifiersPayload?.hashed_phone),
    precomputed_disposition: Boolean(input.precomputedDisposition),
  };

  const insertPayload: Record<string, unknown> = {
    site_id: input.siteId,
    call_id: input.callId,
    sale_id: input.saleId,
    session_id: input.sessionId,
    provider_key: input.providerKey,
    external_id: input.externalId,
    action: input.conversionName,
    conversion_time: input.conversionTime,
    occurred_at: input.occurredAt,
    source_timestamp: input.sourceTimestamp,
    time_confidence: input.timeConfidence,
    occurred_at_source: input.occurredAtSource,
    value_cents: input.valueCents,
    currency: input.currency,
    value_source: input.valueSource,
    value_policy_version: input.valuePolicyVersion,
    value_policy_reason: input.valuePolicyReason,
    value_fallback_used: input.valueFallbackUsed,
    optimization_stage: input.optimizationStage,
    optimization_stage_base: input.optimizationStageBase,
    quality_factor: null,
    optimization_value: input.optimizationValue,
    actual_revenue: input.actualRevenue,
    helper_form_payload: null,
    feature_snapshot: featureSnapshot,
    outcome_timestamp: input.occurredAt,
    model_version: input.modelVersion,
    gclid: input.gclid,
    wbraid: input.wbraid,
    gbraid: input.gbraid,
    status: disposition.status,
    block_reason: disposition.blockReason,
    blocked_at: disposition.blockedAt,
    provider_error_category: disposition.providerErrorCategory,
    provider_error_code: disposition.providerErrorCode,
    source_outbox_event_id: input.sourceOutboxEventId ?? null,
    causal_dna: {},
    user_identifiers: userIdentifiersPayload,
    provider_path: providerPath,
    source_type: input.sourceType ?? null,
    source_idempotency_key: input.sourceIdempotencyKey ?? null,
  };

  if (input.discoveryMethod) insertPayload.discovery_method = input.discoveryMethod;
  if (input.discoveryConfidence != null) insertPayload.discovery_confidence = input.discoveryConfidence;
  if (input.entryReason?.trim()) insertPayload.entry_reason = input.entryReason.trim().slice(0, 500);

  try {
    const { count: historicalSuccessCount, error: historicalSuccessError } = await adminClient
      .from('offline_conversion_queue')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', input.siteId)
      .eq('provider_key', input.providerKey)
      .eq('external_id', input.externalId)
      .in('status', ['COMPLETED', 'UPLOADED', 'COMPLETED_UNVERIFIED']);

    if (historicalSuccessError) {
      logWarn('OCI_ENQUEUE_DEDUP_HISTORICAL_TERMINAL_SUCCESS_CHECK_FAILED', {
        call_id: input.callId,
        stage: input.stage,
        external_id: input.externalId,
        error: historicalSuccessError.message,
      });
      return { enqueued: false, reason: 'error', error: historicalSuccessError.message };
    }

    if ((historicalSuccessCount ?? 0) > 0) {
      logInfo('OCI_ENQUEUE_DEDUP_HISTORICAL_TERMINAL_SUCCESS', {
        call_id: input.callId,
        stage: input.stage,
        external_id: input.externalId,
        provider_key: input.providerKey,
      });
      return {
        enqueued: false,
        reason: 'duplicate',
        queueId: null,
        dispositionClassification: disposition.classification,
      };
    }

    const { data: inserted, error } = await adminClient
      .from('offline_conversion_queue')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        logInfo('enqueue_intent_journal_duplicate', { call_id: input.callId, stage: input.stage });
        return {
          enqueued: false,
          reason: 'duplicate',
          dispositionClassification: disposition.classification,
        };
      }
      logWarn('enqueue_intent_journal_failed', {
        call_id: input.callId,
        stage: input.stage,
        error: error.message,
      });
      return { enqueued: false, reason: 'error', error: error.message };
    }

    const queueId = (inserted as { id: string } | null)?.id ?? null;
    const syncMethod = (input.ociSyncMethod || 'script').trim().toLowerCase();

    if (syncMethod === 'api' && disposition.status === 'QUEUED' && queueId) {
      const dedupe =
        input.fastTrackDedupeLabel === 'seal_fasttrack'
          ? `oci-v5-fasttrack-${queueId}`
          : `oci-intent-journal-${queueId}`;
      try {
        await publishToQStash({
          lane: 'conversion',
          body: { kind: 'oci_export', queue_id: queueId, site_id: input.siteId },
          deduplicationId: dedupe,
          retries: 3,
        });
      } catch (publishErr) {
        logWarn('OCI_FASTTRACK_INTENT_JOURNAL_FAILED', {
          call_id: input.callId,
          queue_id: queueId,
          error: publishErr instanceof Error ? publishErr.message : String(publishErr),
        });
      }
    }

    if (!input.consentMarketing) {
      return {
        enqueued: false,
        reason: 'CONSENT_MISSING',
        queueId,
        dispositionClassification: disposition.classification,
      };
    }

    logInfo('enqueue_intent_journal_ok', {
      call_id: input.callId,
      stage: input.stage,
      queue_id: queueId,
      action: input.conversionName,
      classification: disposition.classification,
    });
    return { enqueued: true, queueId, dispositionClassification: disposition.classification };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn('enqueue_intent_journal_failed', { call_id: input.callId, stage: input.stage, error: message });
    return { enqueued: false, reason: 'error', error: message };
  }
}
