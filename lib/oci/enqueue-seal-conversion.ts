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
import { resolveSealOccurredAt } from '@/lib/oci/occurred-at';
import { appendFunnelEvent } from '@/lib/domain/funnel-kernel/ledger-writer';
import {
  buildOptimizationSnapshot,
} from '@/lib/oci/optimization-contract';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';
import { NEUTRAL_CURRENCY } from '@/lib/i18n/site-locale';
import { resolveWonQueueInitialStatus } from '@/lib/oci/preceding-signals';
import { resolveWonConversionEconomics } from '@/lib/oci/marketing-signal-value-ssot';
import {
  defaultProviderPathFromSyncMethod,
  type IntentJournalClassification,
} from '@/lib/oci/intent-conversion-journal-contract';
import { enqueueIntentConversionJournalRow } from '@/lib/oci/enqueue-intent-conversion-journal-row';

export interface EnqueueSealParams {
  callId: string;
  siteId: string;
  confirmedAt: string;
  saleOccurredAt?: string | null;
  saleAmount: number | null;
  currency: string;
  leadScore: number | null;
  entryReason?: string | null;
  sourceOutboxEventId?: string | null;
  /** Override `offline_conversion_queue.source_type` (default `seal_route`). */
  journalSourceType?: string | null;
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

export function hasAnyClickId(params: {
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
}): boolean {
  return Boolean(
    (params.gclid ?? '').trim() ||
      (params.wbraid ?? '').trim() ||
      (params.gbraid ?? '').trim()
  );
}

// ---------------------------------------------------------------------------
// Site OCI config loader
// ---------------------------------------------------------------------------

function classifySealWonJournalIntent(input: {
  hasMarketing: boolean;
  hasClick: boolean;
  rowStatus: string;
  providerErrorCode: string | null;
  blockReason: string | null;
}): IntentJournalClassification {
  if (!input.hasMarketing || input.providerErrorCode === 'CONSENT_MISSING') {
    return 'INTENT_BLOCKED_BY_CONSENT';
  }
  if (!input.hasClick) return 'INTENT_BLOCKED_BY_CLICK_ID';
  const br = (input.blockReason ?? '').trim();
  if (br === 'PROVIDER_PATH_SCRIPT_V1_REQUIRES_GCLID') {
    return 'WBRAID_GBRAID_AVAILABLE_BUT_SCRIPT_UNSUPPORTED';
  }
  if (input.rowStatus === 'BLOCKED_PRECEDING_SIGNALS') {
    return 'INTENT_JOURNALIZED_NOT_EXPORT_ELIGIBLE';
  }
  if (input.rowStatus === 'QUEUED' || input.rowStatus === 'RETRY') {
    return 'INTENT_JOURNALIZED_READY';
  }
  return 'UNKNOWN_GAP';
}

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
  const {
    callId,
    siteId,
    confirmedAt,
    saleOccurredAt,
    saleAmount,
    currency,
    leadScore,
    entryReason,
    sourceOutboxEventId,
    journalSourceType,
  } = params;

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
    .select('caller_phone_e164, caller_phone_hash_sha256, matched_fingerprint, confirmed_at, created_at')
    .eq('id', callId)
    .eq('site_id', siteId)
    .maybeSingle();

  const callTime = (callCtx as { confirmed_at?: string; created_at?: string } | null)?.confirmed_at
    ?? (callCtx as { created_at?: string } | null)?.created_at
    ?? confirmedAtTrimmed;
  const callerPhoneHashSha256 =
    (callCtx as { caller_phone_hash_sha256?: string | null } | null)?.caller_phone_hash_sha256 ?? null;
  const discovered = await getPrimarySourceWithDiscovery(siteId, directSource, {
    callId,
    callTime,
    callerPhoneE164: (callCtx as { caller_phone_e164?: string | null } | null)?.caller_phone_e164 ?? null,
    fingerprint: (callCtx as { matched_fingerprint?: string | null } | null)?.matched_fingerprint ?? null,
  });
  const occurredAtMeta = resolveSealOccurredAt({
    intentCreatedAt: (callCtx as { created_at?: string | null } | null)?.created_at ?? null,
    saleOccurredAt,
    fallbackConfirmedAt: confirmedAtTrimmed,
  });

  const gclid = discovered?.source?.gclid?.trim() || null;
  const wbraid = discovered?.source?.wbraid?.trim() || null;
  const gbraid = discovered?.source?.gbraid?.trim() || null;
  const discoveryMethod = discovered?.discoveryMethod ?? null;
  const discoveryConfidence = discovered?.discoveryConfidence ?? null;

  const hasClick = hasAnyClickId({ gclid, wbraid, gbraid });
  if (!hasClick) {
    logInfo('enqueue_seal_blocked_missing_attribution', {
      call_id: callId,
      detail: 'BLOCKED_PRECEDING_SIGNALS + MISSING_CLICK_ID per queue SSOT',
    });
  }

  // 2. Marketing consent check
  const hasMarketing = await hasMarketingConsentForCall(siteId, callId);
  if (!hasMarketing) {
    logInfo('enqueue_seal_consent_skip_logged', { call_id: callId, reason: 'marketing_consent_required' });
  }

  // 3. Load site OCI context (currency/sync only)
  const { siteCurrency, syncMethod } = await loadSiteOciContext(siteId);

  const currencySafe = currency?.trim() || siteCurrency;
  const optimizationSnapshot = buildOptimizationSnapshot({
    stage: 'won',
    systemScore: leadScore,
    actualRevenue: saleAmount,
  });
  const wonEconomics = resolveWonConversionEconomics({
    snapshot: optimizationSnapshot,
    siteCurrency: currencySafe,
  });
  const valueUnits = wonEconomics.conversionValueMajor;
  const valueCents = wonEconomics.expectedValueCents;
  const usedFallback = wonEconomics.fallbackUsed;

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

  // 7. Causal DNA - DISABLED (Lean & Mean)

  // 8. Insert into queue. Keep legacy conversion_time populated for compatibility,
  // but canonical export should prefer occurred_at.
  try {
    const queueGate = await resolveWonQueueInitialStatus(siteId, callId);
    const nowIso = new Date().toISOString();

    /** No click: still persist a queue row (export blocked) so WON_MISSING_PIPELINE and ops truth stay aligned. */
    let rowStatus: string = queueGate.status;
    let rowBlockReason: string | null = queueGate.blockReason;
    let providerErrorCategory: string | null = null;
    let providerErrorCode: string | null = null;
    let rowBlockedAt: string | null = null;

    if (!hasMarketing) {
      rowStatus = 'FAILED';
      providerErrorCategory = 'DETERMINISTIC_SKIP';
      providerErrorCode = 'CONSENT_MISSING';
    } else if (!hasClick) {
      rowStatus = 'BLOCKED_PRECEDING_SIGNALS';
      rowBlockReason = 'MISSING_CLICK_ID';
      rowBlockedAt = nowIso;
    }

    const scriptPath = defaultProviderPathFromSyncMethod(syncMethod);
    if (
      hasMarketing &&
      hasClick &&
      rowStatus === 'QUEUED' &&
      scriptPath === 'google_ads_script_v1' &&
      !(gclid ?? '').trim() &&
      (((wbraid ?? '').trim()) || ((gbraid ?? '').trim()))
    ) {
      rowStatus = 'BLOCKED_PRECEDING_SIGNALS';
      rowBlockReason = 'PROVIDER_PATH_SCRIPT_V1_REQUIRES_GCLID';
      rowBlockedAt = nowIso;
    }

    const wonExternalId = computeOfflineConversionExternalId({
      providerKey: 'google_ads',
      action: OPSMANTIK_CONVERSION_NAMES.won,
      callId,
      sessionId,
    });

    const classification = classifySealWonJournalIntent({
      hasMarketing,
      hasClick,
      rowStatus,
      providerErrorCode,
      blockReason: rowBlockReason,
    });

    const journalRes = await enqueueIntentConversionJournalRow({
      siteId,
      providerKey: 'google_ads',
      callId,
      sessionId,
      saleId: null,
      stage: 'won',
      conversionName: OPSMANTIK_CONVERSION_NAMES.won,
      externalId: wonExternalId,
      conversionTime: occurredAtMeta.occurredAt,
      occurredAt: occurredAtMeta.occurredAt,
      sourceTimestamp: occurredAtMeta.sourceTimestamp,
      timeConfidence: occurredAtMeta.timeConfidence,
      occurredAtSource: occurredAtMeta.occurredAtSource,
      valueCents,
      currency: currencySafe,
      valueSource: wonEconomics.valueSource,
      valuePolicyVersion: wonEconomics.policyVersion,
      valuePolicyReason: wonEconomics.policyReason,
      valueFallbackUsed: wonEconomics.fallbackUsed,
      optimizationStage: optimizationSnapshot.optimizationStage,
      optimizationStageBase: optimizationSnapshot.stageBase,
      optimizationValue: optimizationSnapshot.optimizationValue,
      actualRevenue: optimizationSnapshot.actualRevenue,
      modelVersion: optimizationSnapshot.modelVersion,
      gclid,
      wbraid,
      gbraid,
      consentMarketing: hasMarketing,
      consentUserIdentifiers: hasMarketing,
      sendabilityOk: true,
      ociSyncMethod: syncMethod,
      providerPathOverride: scriptPath,
      sourceOutboxEventId: sourceOutboxEventId ?? null,
      sourceType: journalSourceType ?? 'seal_route',
      sourceIdempotencyKey: wonExternalId,
      discoveryMethod,
      discoveryConfidence,
      entryReason: entryReason ?? null,
      precomputedDisposition: {
        status: rowStatus,
        blockReason: rowBlockReason,
        blockedAt: rowBlockedAt,
        providerErrorCategory,
        providerErrorCode,
        classification,
      },
      userIdentifiersExplicit: null,
      fastTrackDedupeLabel: 'seal_fasttrack',
      callCallerPhoneHashSha256: callerPhoneHashSha256,
      featureSnapshot: {
        value_policy_version: wonEconomics.policyVersion,
        value_policy_reason: wonEconomics.policyReason,
        value_source: wonEconomics.valueSource,
        discovery_method: discoveryMethod,
        discovery_confidence: discoveryConfidence,
        has_gclid: Boolean(gclid),
        has_wbraid: Boolean(wbraid),
        has_gbraid: Boolean(gbraid),
      },
    });

    if (journalRes.reason === 'duplicate') {
      logInfo('enqueue_seal_skip', { call_id: callId, reason: 'duplicate' });
      return { enqueued: false, reason: 'duplicate', usedFallback };
    }
    if (journalRes.reason === 'error') {
      logWarn('enqueue_seal_failed', { call_id: callId, error: journalRes.error });
      return { enqueued: false, reason: 'error', error: journalRes.error, usedFallback };
    }

    const queueId = journalRes.queueId ?? null;
    if (queueId) {
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

    if (!hasMarketing) {
      return { enqueued: false, reason: 'marketing_consent_required', usedFallback, queueId };
    }

    return { enqueued: true, queueId, value: valueUnits ?? 0, usedFallback };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn('enqueue_seal_failed', { call_id: callId, error: message });
    return { enqueued: false, reason: 'error', error: message };
  }
}
