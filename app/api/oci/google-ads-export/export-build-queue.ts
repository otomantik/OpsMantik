import { formatGoogleAdsTimeOrNull } from '@/lib/utils/format-google-ads-time';
import { minorToMajor } from '@/lib/i18n/currency';
import { NEUTRAL_CURRENCY } from '@/lib/i18n/site-locale';
import { buildOrderId } from '@/lib/oci/build-order-id';
import { computeOfflineConversionExternalId } from '@/lib/oci/external-id';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/domain/mizan-mantik';
import { validateOciQueueValueCents } from '@/lib/oci/export-value-guard';
import { pickCanonicalOccurredAt } from '@/lib/oci/occurred-at';
import { buildSingleConversionGroupKey } from '@/lib/oci/single-conversion-highest-only';
import { ensureCurrencyCode, ensureNumericValue } from '@/lib/oci/google-ads-export/sanitize';
import type { GoogleAdsConversionItem, QueueRow, RankedExportCandidate } from '@/lib/oci/google-ads-export/types';
import type { ExportAuthContext } from './export-auth';

export type QueueBuildResult = {
  conversions: GoogleAdsConversionItem[];
  queueCandidates: RankedExportCandidate[];
  blockedQueueIds: string[];
  blockedQueueTimeIds: string[];
  blockedValueZeroIds: string[];
  blockedExpiredIds: string[];
  blockedExportGateIds: string[];
};

export function buildQueueItems(
  ctx: ExportAuthContext,
  rawList: QueueRow[],
  sessionByCall: Record<string, string>,
  intentCreatedByCall: Record<string, string>
): QueueBuildResult {
  const conversions: GoogleAdsConversionItem[] = [];
  const queueCandidates: RankedExportCandidate[] = [];
  const blockedQueueIds: string[] = [];
  const blockedQueueTimeIds: string[] = [];
  const blockedValueZeroIds: string[] = [];
  const blockedExpiredIds: string[] = [];
  const blockedExportGateIds: string[] = [];

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
      row.created_at,
    ]);
    const conversionTime = formatGoogleAdsTimeOrNull(baseTs, ctx.site.timezone);
    if (!conversionTime) {
      blockedQueueTimeIds.push(row.id);
      continue;
    }
    const valueGuard = validateOciQueueValueCents(row.value_cents);
    if (!valueGuard.ok) {
      blockedValueZeroIds.push(row.id);
      continue;
    }
    const rowCurrency = row.currency || ctx.site.currency || NEUTRAL_CURRENCY;
    const conversionValue = ensureNumericValue(
      typeof row.optimization_value === 'number' && Number.isFinite(row.optimization_value)
        ? row.optimization_value
        : minorToMajor(valueGuard.normalized, rowCurrency)
    );
    if (!(conversionValue > 0)) {
      blockedExpiredIds.push(row.id);
      continue;
    }

    const conversionCurrency = ensureCurrencyCode(rowCurrency);
    const fallbackOrderId = `seal_${row.id}`;
    const externalId =
      row.external_id ||
      computeOfflineConversionExternalId({
        providerKey: row.provider_key,
        action: row.action,
        saleId: row.sale_id,
        callId: row.call_id,
        sessionId: row.session_id,
      });
    const orderId = buildOrderId(
      OPSMANTIK_CONVERSION_NAMES.won,
      row.gclid || row.wbraid || row.gbraid || null,
      conversionTime,
      fallbackOrderId,
      row.id,
      valueGuard.normalized
    );

    const item: GoogleAdsConversionItem = {
      id: fallbackOrderId,
      orderId: externalId || orderId || fallbackOrderId,
      gclid: (row.gclid || '').trim(),
      wbraid: (row.wbraid || '').trim(),
      gbraid: (row.gbraid || '').trim(),
      conversionName: OPSMANTIK_CONVERSION_NAMES.won,
      conversionTime,
      conversionValue,
      conversionCurrency,
    };
    conversions.push(item);
    queueCandidates.push({
      id: item.id,
      groupKey: buildSingleConversionGroupKey(
        row.session_id ?? (row.call_id ? sessionByCall[row.call_id] ?? null : null),
        row.call_id ?? null,
        row.id
      ),
      gear: 'won',
      sortKey: item.conversionTime,
      value: item,
    });
  }

  return {
    conversions,
    queueCandidates,
    blockedQueueIds,
    blockedQueueTimeIds,
    blockedValueZeroIds,
    blockedExpiredIds,
    blockedExportGateIds,
  };
}
