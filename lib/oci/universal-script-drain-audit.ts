/**
 * PR-9I — Deterministic bucket classification for universal script-drain audit (read-only).
 * Aligns with export-build-queue + universal-click-id-selection + hashed-phone courier rules.
 */

import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';
import { validateOciQueueValueCents } from '@/lib/oci/export-value-guard';
import { extractHashedPhoneFromExportSources } from '@/lib/oci/hashed-phone-courier';
import { formatGoogleAdsTimeOrNull } from '@/lib/utils/format-google-ads-time';
import { pickCanonicalOccurredAt } from '@/lib/oci/occurred-at';
import { resolveUploadIdentifier } from '@/lib/oci/universal-click-id-selection';
import type { QueueRow } from '@/lib/oci/google-ads-export/types';

export const PR9I_SELECTED_IDENTIFIER_POLICY = 'gclid>wbraid>gbraid' as const;

export type UniversalDrainAuditBucket =
  | 'EXPORTABLE_GCLID'
  | 'EXPORTABLE_WBRAID'
  | 'EXPORTABLE_GBRAID'
  | 'EXPORTABLE_GCLID_WITH_HASHED_PHONE'
  | 'EXPORTABLE_WBRAID_WITH_HASHED_PHONE'
  | 'EXPORTABLE_GBRAID_WITH_HASHED_PHONE'
  | 'NOT_EXPORTABLE_HASHED_PHONE_ONLY'
  | 'NOT_EXPORTABLE_NO_IDENTIFIER'
  | 'NOT_EXPORTABLE_INVALID_VALUE'
  | 'NOT_EXPORTABLE_INVALID_TIME'
  | 'NOT_EXPORTABLE_UNSUPPORTED_ACTION'
  | 'NOT_EXPORTABLE_TERMINAL_OR_NOT_PENDING'
  | 'NEEDS_REVIEW_MULTIPLE_CLICK_IDS';

export type UniversalDrainAuditFlags = {
  hadGclid: boolean;
  hadWbraid: boolean;
  hadGbraid: boolean;
  hashedPhonePresent: boolean;
  multipleClickIds: boolean;
};

export type UniversalDrainAuditResult = {
  bucket: UniversalDrainAuditBucket;
  /** Selected click id after gclid > wbraid > gbraid (only when exportable). */
  selectedType: 'gclid' | 'wbraid' | 'gbraid' | null;
  flags: UniversalDrainAuditFlags;
};

function resolveConversionName(row: QueueRow): string | null {
  const actionTrim = (row.action ?? '').trim();
  const st = (row.optimization_stage ?? '').trim().toLowerCase();
  if (actionTrim) return actionTrim;
  if (st === 'contacted' || st === 'offered' || st === 'junk' || st === 'won') {
    const key = st === 'junk' ? 'junk' : st;
    return OPSMANTIK_CONVERSION_NAMES[key as keyof typeof OPSMANTIK_CONVERSION_NAMES] ?? null;
  }
  return null;
}

function exportableBucketFor(
  selected: 'gclid' | 'wbraid' | 'gbraid',
  hashedPhonePresent: boolean
):
  | 'EXPORTABLE_GCLID'
  | 'EXPORTABLE_WBRAID'
  | 'EXPORTABLE_GBRAID'
  | 'EXPORTABLE_GCLID_WITH_HASHED_PHONE'
  | 'EXPORTABLE_WBRAID_WITH_HASHED_PHONE'
  | 'EXPORTABLE_GBRAID_WITH_HASHED_PHONE' {
  if (selected === 'gclid') {
    return hashedPhonePresent ? 'EXPORTABLE_GCLID_WITH_HASHED_PHONE' : 'EXPORTABLE_GCLID';
  }
  if (selected === 'wbraid') {
    return hashedPhonePresent ? 'EXPORTABLE_WBRAID_WITH_HASHED_PHONE' : 'EXPORTABLE_WBRAID';
  }
  return hashedPhonePresent ? 'EXPORTABLE_GBRAID_WITH_HASHED_PHONE' : 'EXPORTABLE_GBRAID';
}

/**
 * Classify one queue row for PR-9I universal script drain (Google Ads Script lane).
 * Does not log or return raw click ids or hash hex.
 */
export function classifyUniversalDrainRow(
  row: QueueRow & { status?: string | null },
  site: { currency?: string | null; timezone?: string | null },
  opts?: {
    callerPhoneHashSha256?: string | null;
    intentCreatedAt?: string | null;
    /** When false, row is treated as non-pending for bucket 12. */
    expectPending?: boolean;
    providerKey?: string;
  }
): UniversalDrainAuditResult {
  const expectPending = opts?.expectPending !== false;
  const providerKey = opts?.providerKey ?? 'google_ads';
  const st = String(row.status ?? '')
    .trim()
    .toUpperCase();
  if (!expectPending || (st !== 'QUEUED' && st !== 'RETRY')) {
    return {
      bucket: 'NOT_EXPORTABLE_TERMINAL_OR_NOT_PENDING',
      selectedType: null,
      flags: {
        hadGclid: false,
        hadWbraid: false,
        hadGbraid: false,
        hashedPhonePresent: false,
        multipleClickIds: false,
      },
    };
  }

  const pk = String(row.provider_key ?? '').trim() || providerKey;
  if (pk !== providerKey) {
    return {
      bucket: 'NOT_EXPORTABLE_UNSUPPORTED_ACTION',
      selectedType: null,
      flags: {
        hadGclid: false,
        hadWbraid: false,
        hadGbraid: false,
        hashedPhonePresent: false,
        multipleClickIds: false,
      },
    };
  }

  if (!row.call_id) {
    return {
      bucket: 'NOT_EXPORTABLE_UNSUPPORTED_ACTION',
      selectedType: null,
      flags: {
        hadGclid: false,
        hadWbraid: false,
        hadGbraid: false,
        hashedPhonePresent: false,
        multipleClickIds: false,
      },
    };
  }

  const conversionName = resolveConversionName(row);
  if (!conversionName) {
    return {
      bucket: 'NOT_EXPORTABLE_UNSUPPORTED_ACTION',
      selectedType: null,
      flags: {
        hadGclid: false,
        hadWbraid: false,
        hadGbraid: false,
        hashedPhonePresent: false,
        multipleClickIds: false,
      },
    };
  }

  const rowCurrency = (row.currency ?? '').trim();
  const siteCurrency = (site.currency ?? '').trim();
  if (!rowCurrency && !siteCurrency) {
    return {
      bucket: 'NOT_EXPORTABLE_UNSUPPORTED_ACTION',
      selectedType: null,
      flags: {
        hadGclid: false,
        hadWbraid: false,
        hadGbraid: false,
        hashedPhonePresent: false,
        multipleClickIds: false,
      },
    };
  }

  const baseTs = pickCanonicalOccurredAt([
    row.occurred_at,
    row.conversion_time,
    opts?.intentCreatedAt ?? null,
  ]);
  const conversionTime = formatGoogleAdsTimeOrNull(baseTs, site.timezone);
  if (!conversionTime) {
    return {
      bucket: 'NOT_EXPORTABLE_INVALID_TIME',
      selectedType: null,
      flags: {
        hadGclid: false,
        hadWbraid: false,
        hadGbraid: false,
        hashedPhonePresent: false,
        multipleClickIds: false,
      },
    };
  }

  const valueGuard = validateOciQueueValueCents(row.value_cents);
  if (!valueGuard.ok) {
    return {
      bucket: 'NOT_EXPORTABLE_INVALID_VALUE',
      selectedType: null,
      flags: {
        hadGclid: false,
        hadWbraid: false,
        hadGbraid: false,
        hashedPhonePresent: false,
        multipleClickIds: false,
      },
    };
  }

  const extracted = extractHashedPhoneFromExportSources({
    row,
    callerPhoneHashSha256: opts?.callerPhoneHashSha256 ?? null,
  });
  const hashedPhonePresent = extracted.hashedPhoneNumber != null;

  const idRes = resolveUploadIdentifier(
    { gclid: row.gclid, wbraid: row.wbraid, gbraid: row.gbraid },
    { hasVerifiedHashedPhoneCourier: hashedPhonePresent }
  );

  const flags: UniversalDrainAuditFlags = {
    hadGclid: idRes.hadGclid,
    hadWbraid: idRes.hadWbraid,
    hadGbraid: idRes.hadGbraid,
    hashedPhonePresent,
    multipleClickIds: idRes.multipleClickIds,
  };

  if (!idRes.valid) {
    if (idRes.reason === 'HASHED_PHONE_ONLY_SCRIPT_LANE_UNSUPPORTED') {
      return { bucket: 'NOT_EXPORTABLE_HASHED_PHONE_ONLY', selectedType: null, flags };
    }
    return { bucket: 'NOT_EXPORTABLE_NO_IDENTIFIER', selectedType: null, flags };
  }

  const exportBucket = exportableBucketFor(idRes.selectedType!, hashedPhonePresent);
  return {
    bucket: exportBucket,
    selectedType: idRes.selectedType,
    flags,
  };
}

/** Rows counted as exportable_total / ready universal drain in audit reports. */
export function isExportableUniversalDrainBucket(bucket: UniversalDrainAuditBucket): boolean {
  return (
    bucket === 'EXPORTABLE_GCLID' ||
    bucket === 'EXPORTABLE_WBRAID' ||
    bucket === 'EXPORTABLE_GBRAID' ||
    bucket === 'EXPORTABLE_GCLID_WITH_HASHED_PHONE' ||
    bucket === 'EXPORTABLE_WBRAID_WITH_HASHED_PHONE' ||
    bucket === 'EXPORTABLE_GBRAID_WITH_HASHED_PHONE'
  );
}
