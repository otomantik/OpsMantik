import { formatGoogleAdsTimeOrNull } from '@/lib/utils/format-google-ads-time';
import { minorToMajor } from '@/lib/i18n/currency';
import { buildOrderId } from '@/lib/oci/build-order-id';
import { computeOfflineConversionExternalId } from '@/lib/oci/external-id';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';
import { validateExportRow } from '@/lib/oci/export-gate';
import { validateOciQueueValueCents } from '@/lib/oci/export-value-guard';
import { pickCanonicalOccurredAt } from '@/lib/oci/occurred-at';
import { getConversionActionConfig, parseExportConfig, type ChannelKey } from '@/lib/oci/site-export-config';
import { buildSingleConversionGroupKey } from '@/lib/oci/single-conversion-highest-only';
import { ensureCurrencyCode, ensureNumericValue } from '@/lib/oci/google-ads-export/sanitize';
import { resolveQueueExportGear } from '@/lib/oci/google-ads-export/signal-normalizers';
import type { GoogleAdsConversionItem, QueueRow, RankedExportCandidate } from '@/lib/oci/google-ads-export/types';
import {
  appendHashedPhoneCourier,
  extractEmailHashFromQueueRow,
  extractHashedPhoneFromExportSources,
  type HashedPhoneCourierSource,
} from '@/lib/oci/hashed-phone-courier';
import { applyCourierZodArmorToConversionItem } from '@/lib/oci/validation/google-ads-hashed-identifiers.zod';
import type { ExportAuthContext } from './export-auth';

export type QueueHashedPhoneDiagnostics = {
  hashed_phone_available_count: number;
  hashed_phone_invalid_count: number;
  enhanced_signal_available_count: number;
  /** Rows that reached courier extraction (same as inner conversions built). */
  hashed_phone_candidate_count: number;
  /** Filled in buildExportItems from final returned `combined` array. */
  hashed_phone_exported_count: number;
  /** Filled in buildExportItems from final returned `combined` array. */
  hashed_phone_missing_count: number;
  /** Aggregates safe source enums for hashes that survived into `combined`. */
  hashed_phone_source_counts: Record<string, number>;
};

export type QueueCurrencyDiagnostics = {
  currency_missing_count: number;
  currency_unexpected_count: number;
  currency_defaulted_count: number;
};

export type HashedPhoneAttribution = { queueId: string; source: HashedPhoneCourierSource | null };

export type QueueBuildResult = {
  conversions: GoogleAdsConversionItem[];
  queueCandidates: RankedExportCandidate[];
  blockedQueueIds: string[];
  blockedQueueTimeIds: string[];
  blockedValueZeroIds: string[];
  blockedExpiredIds: string[];
  blockedExportGateIds: string[];
  blockedCurrencyIds: string[];
  /** action + optimization_stage both missing/unknown — no silent default to Won */
  blockedMissingConversionActionIds: string[];
  hashedPhoneDiagnostics: QueueHashedPhoneDiagnostics;
  currencyDiagnostics: QueueCurrencyDiagnostics;
  /** Per-queue provenance for hashes (used to aggregate source_counts for returned rows only). */
  hashedPhoneAttributions: HashedPhoneAttribution[];
};

/**
 * PR-9H.7D: courier-only SHA-256 hex from queue blob / call projection via `extractHashedPhoneFromExportSources`.
 */
export function buildQueueItems(
  ctx: ExportAuthContext,
  rawList: QueueRow[],
  sessionByCall: Record<string, string>,
  intentCreatedByCall: Record<string, string>,
  callerPhoneHashByCall?: Record<string, string | undefined>
): QueueBuildResult {
  const conversions: GoogleAdsConversionItem[] = [];
  const queueCandidates: RankedExportCandidate[] = [];
  const blockedQueueIds: string[] = [];
  const blockedQueueTimeIds: string[] = [];
  const blockedValueZeroIds: string[] = [];
  const blockedExpiredIds: string[] = [];
  const blockedExportGateIds: string[] = [];
  const blockedCurrencyIds: string[] = [];
  const blockedMissingConversionActionIds: string[] = [];
  const hashedPhoneAttributions: HashedPhoneAttribution[] = [];
  const tallies = {
    hashed_phone_available_count: 0,
    hashed_phone_invalid_count: 0,
    enhanced_signal_available_count: 0,
    hashed_phone_candidate_count: 0,
  };
  const currencyTallies: QueueCurrencyDiagnostics = {
    currency_missing_count: 0,
    currency_unexpected_count: 0,
    currency_defaulted_count: 0,
  };

  const hashLookup = callerPhoneHashByCall ?? {};

  for (let i = 0; i < rawList.length; i++) {
    const row = rawList[i];
    if (!row.call_id) {
      blockedExportGateIds.push(row.id);
      continue;
    }
    const baseTs = pickCanonicalOccurredAt([
      row.occurred_at,
      row.conversion_time,
      intentCreatedByCall[row.call_id] ?? null,
    ]);
    const conversionTime = formatGoogleAdsTimeOrNull(baseTs, ctx.site.timezone);
    if (!conversionTime || !baseTs) {
      blockedQueueTimeIds.push(row.id);
      continue;
    }
    const valueGuard = validateOciQueueValueCents(row.value_cents);
    if (!valueGuard.ok) {
      blockedValueZeroIds.push(row.id);
      continue;
    }
    const rowCurrency = (row.currency ?? '').trim();
    const siteCurrency = (ctx.site.currency ?? '').trim();
    if (!rowCurrency && !siteCurrency) {
      currencyTallies.currency_missing_count += 1;
      blockedCurrencyIds.push(row.id);
      continue;
    }
    if (!rowCurrency && siteCurrency) {
      currencyTallies.currency_defaulted_count += 1;
    }
    if (rowCurrency && siteCurrency && rowCurrency.toUpperCase() !== siteCurrency.toUpperCase()) {
      currencyTallies.currency_unexpected_count += 1;
    }
    const resolvedCurrency = rowCurrency || siteCurrency;
    const conversionValue = ensureNumericValue(
      minorToMajor(valueGuard.normalized, resolvedCurrency)
    );
    if (!(conversionValue > 0)) {
      blockedExpiredIds.push(row.id);
      continue;
    }

    const conversionCurrency = ensureCurrencyCode(resolvedCurrency);
    const fallbackOrderId = `seal_${row.id}`;
    const actionTrim = (row.action ?? '').trim();
    const st = (row.optimization_stage ?? '').trim().toLowerCase();
    let conversionName: string;
    if (actionTrim) {
      conversionName = actionTrim;
    } else if (st === 'contacted' || st === 'offered' || st === 'junk' || st === 'won') {
      const key = st === 'junk' ? 'junk' : st;
      conversionName = OPSMANTIK_CONVERSION_NAMES[key as keyof typeof OPSMANTIK_CONVERSION_NAMES];
    } else {
      blockedMissingConversionActionIds.push(row.id);
      continue;
    }
    const gear = resolveQueueExportGear(row);
    const externalId = row.external_id || computeOfflineConversionExternalId({
      providerKey: row.provider_key,
      action: conversionName,
      saleId: row.sale_id,
      callId: row.call_id,
      sessionId: row.session_id,
    });
    const orderId = buildOrderId(
      conversionName,
      row.gclid || row.wbraid || row.gbraid || null,
      conversionTime,
      fallbackOrderId,
      row.id,
      valueGuard.normalized
    );

    const extracted = extractHashedPhoneFromExportSources({
      row,
      callerPhoneHashSha256: row.call_id ? hashLookup[row.call_id] ?? null : null,
    });
    const phoneHash = extracted.hashedPhoneNumber;
    const hpSource = extracted.source;
    tallies.hashed_phone_invalid_count += extracted.invalidAdds;
    tallies.hashed_phone_candidate_count += 1;

    const emailHash = extractEmailHashFromQueueRow(row);

    const exportCfg = ctx.exportConfig ?? parseExportConfig(null);
    const channel: ChannelKey = exportCfg.channels[0] ?? 'phone';
    const actionConfig = getConversionActionConfig(exportCfg, channel, gear);
    const clickDate = row.jit_call_created_at ? new Date(row.jit_call_created_at) : null;
    const signalDate = new Date(baseTs);
    if (
      !validateExportRow(
        {
          id: row.id,
          gclid: row.gclid,
          wbraid: row.wbraid,
          gbraid: row.gbraid,
          hashed_phone: phoneHash ?? undefined,
          hashed_email: emailHash ?? undefined,
          value_cents: valueGuard.normalized,
          click_date: clickDate,
          signal_date: signalDate,
        },
        exportCfg,
        actionConfig
      ).ok
    ) {
      blockedExportGateIds.push(row.id);
      continue;
    }

    if (phoneHash) {
      tallies.hashed_phone_available_count += 1;
      hashedPhoneAttributions.push({ queueId: row.id, source: hpSource });
    }
    if (phoneHash || emailHash) tallies.enhanced_signal_available_count += 1;

    let item: GoogleAdsConversionItem = {
      id: fallbackOrderId,
      orderId: externalId || orderId || fallbackOrderId,
      gclid: (row.gclid || '').trim(),
      wbraid: (row.wbraid || '').trim(),
      gbraid: (row.gbraid || '').trim(),
      selected_click_id_kind: row.gclid?.trim()
        ? 'gclid'
        : row.wbraid?.trim()
          ? 'wbraid'
          : row.gbraid?.trim()
            ? 'gbraid'
            : null,
      conversionName,
      conversionTime,
      conversionValue,
      conversionCurrency,
    };

    if (phoneHash) {
      item = appendHashedPhoneCourier(item, phoneHash);
    }

    if (emailHash) {
      const uid = [...(item.userIdentifiers ?? item.user_identifiers ?? [])];
      if (!uid.some((x) => x.type === 'hashed_email')) {
        uid.push({ type: 'hashed_email', value: emailHash });
      }
      item = {
        ...item,
        hashed_email: emailHash,
        userIdentifiers: uid,
        user_identifiers: uid,
      };
    }

    const armored = applyCourierZodArmorToConversionItem(item);
    conversions.push(armored);
    queueCandidates.push({
      id: armored.id,
      groupKey: buildSingleConversionGroupKey(
        row.session_id ?? (row.call_id ? sessionByCall[row.call_id] ?? null : null),
        row.call_id ?? null,
        row.id
      ),
      gear,
      sortKey: armored.conversionTime,
      value: armored,
    });
  }

  const hashedPhoneDiagnostics: QueueHashedPhoneDiagnostics = {
    ...tallies,
    hashed_phone_exported_count: 0,
    hashed_phone_missing_count: 0,
    hashed_phone_source_counts: {} as Record<string, number>,
  };

  return {
    conversions,
    queueCandidates,
    blockedQueueIds,
    blockedQueueTimeIds,
    blockedValueZeroIds,
    blockedExpiredIds,
    blockedExportGateIds,
    blockedCurrencyIds,
    blockedMissingConversionActionIds,
    hashedPhoneDiagnostics,
    currencyDiagnostics: currencyTallies,
    hashedPhoneAttributions,
  };
}
