/**
 * PR-9H.6 — Unified intent → offline_conversion_queue journal contract.
 * Journal-only OCI contract (`offline_conversion_queue` SSOT).
 */

import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';
import type { OptimizationStage } from '@/lib/oci/optimization-contract';

function hasAnyClickIdLocal(params: {
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
}): boolean {
  return Boolean(
    (params.gclid ?? '').trim() || (params.wbraid ?? '').trim() || (params.gbraid ?? '').trim()
  );
}

export const INTENT_JOURNAL_STAGES = ['contacted', 'offered', 'won', 'junk_exclusion'] as const;
export type IntentJournalStage = (typeof INTENT_JOURNAL_STAGES)[number];

export const GOOGLE_ADS_PROVIDER_PATHS = [
  'google_ads_script_v1',
  'google_ads_api_click_conversion',
  'google_ads_api_enhanced_conversions_leads',
] as const;
export type GoogleAdsProviderPath = (typeof GOOGLE_ADS_PROVIDER_PATHS)[number];

export const SIGNAL_TYPES = [
  'gclid',
  'wbraid',
  'gbraid',
  'hashed_phone',
  'hashed_email',
  'order_id',
  'external_id',
] as const;
export type OciSignalType = (typeof SIGNAL_TYPES)[number];

/** block_reason / provider_error_code style labels for ops — not all map 1:1 to DB status. */
export type IntentJournalClassification =
  | 'INTENT_NOT_JOURNALIZED'
  | 'INTENT_JOURNALIZED_NOT_EXPORT_ELIGIBLE'
  | 'INTENT_BLOCKED_BY_CONSENT'
  | 'INTENT_BLOCKED_BY_CLICK_ID'
  | 'INTENT_BLOCKED_BY_PROVIDER_PATH'
  | 'INTENT_BLOCKED_BY_SENDABILITY'
  | 'INTENT_ALREADY_COMPLETED'
  | 'INTENT_PROCESSING_STUCK'
  | 'INTENT_DUPLICATE_SUPPRESSED'
  | 'ENHANCED_SIGNAL_AVAILABLE_BUT_NOT_USED'
  | 'WBRAID_GBRAID_AVAILABLE_BUT_SCRIPT_UNSUPPORTED'
  | 'UNKNOWN_GAP'
  | 'INTENT_JOURNALIZED_READY';

export function intentStageToOptimizationStage(stage: IntentJournalStage): OptimizationStage {
  if (stage === 'junk_exclusion') return 'junk';
  return stage;
}

export function intentStageToConversionName(stage: IntentJournalStage): string {
  return OPSMANTIK_CONVERSION_NAMES[intentStageToOptimizationStage(stage)];
}

export function optimizationStageToIntentStage(stage: OptimizationStage): IntentJournalStage {
  if (stage === 'junk') return 'junk_exclusion';
  return stage as IntentJournalStage;
}

export type UserIdentifiersPayload = {
  hashed_email?: string;
  hashed_phone?: string;
  /** Legacy / alias — mirror `hashed_phone` when projected from tooling. */
  hashedPhoneNumber?: string;
  /** Provenance: e.g. `caller_phone_hash_sha256` journal projection (PR-9H.7A). */
  source?: string;
  normalization_version: string;
  consent?: { marketing?: boolean; user_identifiers?: boolean };
};

/**
 * Resolve default provider path from site sync method (script pull vs API push).
 */
export function defaultProviderPathFromSyncMethod(
  ociSyncMethod: string | null | undefined
): GoogleAdsProviderPath {
  const m = (ociSyncMethod || 'script').trim().toLowerCase();
  if (m === 'api') return 'google_ads_api_click_conversion';
  return 'google_ads_script_v1';
}

export type ScriptV1Readiness = {
  scriptV1GclidReady: boolean;
  apiClickIdReady: boolean;
  enhancedConversionsLeadsReady: boolean;
};

export function evaluateSignalReadiness(params: {
  gclid: string | null | undefined;
  wbraid: string | null | undefined;
  gbraid: string | null | undefined;
  userIdentifiers?: UserIdentifiersPayload | null;
}): ScriptV1Readiness {
  const g = Boolean(params.gclid?.trim());
  const w = Boolean(params.wbraid?.trim());
  const b = Boolean(params.gbraid?.trim());
  const he = Boolean(params.userIdentifiers?.hashed_email?.trim());
  const hp = Boolean(params.userIdentifiers?.hashed_phone?.trim());
  return {
    scriptV1GclidReady: g,
    apiClickIdReady: g || w || b,
    enhancedConversionsLeadsReady: he || hp,
  };
}

export type QueueJournalDisposition = {
  status: 'QUEUED' | 'BLOCKED_PRECEDING_SIGNALS' | 'FAILED';
  blockReason: string | null;
  blockedAt: string | null;
  providerErrorCategory: string | null;
  providerErrorCode: string | null;
  providerPath: GoogleAdsProviderPath;
  classification: IntentJournalClassification;
};

/** Seal / special producers: deterministic status already merged (precursor gates, consent, Script v1, etc.). */
export type PrecomputedJournalDispositionInput = {
  status: string;
  blockReason: string | null;
  blockedAt: string | null;
  providerErrorCategory: string | null;
  providerErrorCode: string | null;
  classification: IntentJournalClassification;
};

/**
 * Pure planner: maps consent, sendability, click ids, provider path, and hashed identifiers
 * to initial queue status + block metadata. Does not persist.
 */
export function resolveQueueJournalDisposition(input: {
  providerPath: GoogleAdsProviderPath;
  consentMarketing: boolean;
  /** Consent to store/hash user identifiers for Enhanced Conversions */
  consentUserIdentifiers: boolean;
  sendabilityOk: boolean;
  gclid: string | null | undefined;
  wbraid: string | null | undefined;
  gbraid: string | null | undefined;
  userIdentifiers: UserIdentifiersPayload | null | undefined;
  nowIso: string;
}): QueueJournalDisposition {
  if (!input.consentMarketing) {
    return {
      status: 'FAILED',
      blockReason: null,
      blockedAt: null,
      providerErrorCategory: 'DETERMINISTIC_SKIP',
      providerErrorCode: 'CONSENT_MISSING',
      providerPath: input.providerPath,
      classification: 'INTENT_BLOCKED_BY_CONSENT',
    };
  }

  if (!input.sendabilityOk) {
    return {
      status: 'BLOCKED_PRECEDING_SIGNALS',
      blockReason: 'NOT_SENDABLE',
      blockedAt: input.nowIso,
      providerErrorCategory: null,
      providerErrorCode: null,
      providerPath: input.providerPath,
      classification: 'INTENT_BLOCKED_BY_SENDABILITY',
    };
  }

  const hasClick = hasAnyClickIdLocal({
    gclid: input.gclid,
    wbraid: input.wbraid,
    gbraid: input.gbraid,
  });

  const readiness = evaluateSignalReadiness({
    gclid: input.gclid,
    wbraid: input.wbraid,
    gbraid: input.gbraid,
    userIdentifiers: input.userIdentifiers,
  });

  if (!hasClick && !readiness.enhancedConversionsLeadsReady) {
    return {
      status: 'BLOCKED_PRECEDING_SIGNALS',
      blockReason: 'MISSING_CLICK_ID',
      blockedAt: input.nowIso,
      providerErrorCategory: null,
      providerErrorCode: null,
      providerPath: input.providerPath,
      classification: 'INTENT_BLOCKED_BY_CLICK_ID',
    };
  }

  if (
    input.providerPath === 'google_ads_script_v1' &&
    hasClick &&
    !readiness.scriptV1GclidReady
  ) {
    return {
      status: 'BLOCKED_PRECEDING_SIGNALS',
      blockReason: 'PROVIDER_PATH_SCRIPT_V1_REQUIRES_GCLID',
      blockedAt: input.nowIso,
      providerErrorCategory: null,
      providerErrorCode: null,
      providerPath: input.providerPath,
      classification: 'WBRAID_GBRAID_AVAILABLE_BUT_SCRIPT_UNSUPPORTED',
    };
  }

  if (
    input.providerPath === 'google_ads_script_v1' &&
    !hasClick &&
    readiness.enhancedConversionsLeadsReady
  ) {
    return {
      status: 'BLOCKED_PRECEDING_SIGNALS',
      blockReason: 'PROVIDER_PATH_SCRIPT_V1_NO_ENHANCED_CONVERSIONS',
      blockedAt: input.nowIso,
      providerErrorCategory: null,
      providerErrorCode: null,
      providerPath: input.providerPath,
      classification: 'ENHANCED_SIGNAL_AVAILABLE_BUT_NOT_USED',
    };
  }

  if (
    input.userIdentifiers &&
    (input.userIdentifiers.hashed_email || input.userIdentifiers.hashed_phone) &&
    !input.consentUserIdentifiers
  ) {
    return {
      status: 'FAILED',
      blockReason: null,
      blockedAt: null,
      providerErrorCategory: 'DETERMINISTIC_SKIP',
      providerErrorCode: 'CONSENT_MISSING_USER_IDENTIFIERS',
      providerPath: input.providerPath,
      classification: 'INTENT_BLOCKED_BY_CONSENT',
    };
  }

  return {
    status: 'QUEUED',
    blockReason: null,
    blockedAt: null,
    providerErrorCategory: null,
    providerErrorCode: null,
    providerPath: input.providerPath,
    classification: 'INTENT_JOURNALIZED_READY',
  };
}
