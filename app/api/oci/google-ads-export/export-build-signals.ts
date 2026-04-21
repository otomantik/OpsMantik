import { formatGoogleAdsTimeOrNull } from '@/lib/utils/format-google-ads-time';
import { NEUTRAL_CURRENCY } from '@/lib/i18n/site-locale';
import { buildOrderId } from '@/lib/oci/build-order-id';
import { logWarn } from '@/lib/logging/logger';
import { validateOciSignalConversionValue } from '@/lib/oci/export-value-guard';
import { pickCanonicalOccurredAt } from '@/lib/oci/occurred-at';
import { buildSingleConversionGroupKey } from '@/lib/oci/single-conversion-highest-only';
import { resolveSignalStage } from '@/lib/oci/google-ads-export/signal-normalizers';
import type { GoogleAdsConversionItem, RankedExportCandidate } from '@/lib/oci/google-ads-export/types';
import type { ExportAuthContext } from './export-auth';

export type SignalBuildResult = {
  signalItems: GoogleAdsConversionItem[];
  signalCandidates: RankedExportCandidate[];
  blockedSignalIds: string[];
  blockedSignalTimeIds: string[];
  blockedSignalValueIds: string[];
};

export function buildSignalItems(
  ctx: ExportAuthContext,
  signalList: Array<Record<string, unknown>>
): SignalBuildResult {
  const signalItems: GoogleAdsConversionItem[] = [];
  const signalCandidates: RankedExportCandidate[] = [];
  const blockedSignalIds: string[] = [];
  const blockedSignalTimeIds: string[] = [];
  const blockedSignalValueIds: string[] = [];

  for (let i = 0; i < signalList.length; i++) {
    const sig = signalList[i];
    const signalId = String(sig.id ?? '');
    const callId = typeof sig.call_id === 'string' ? sig.call_id : null;
    if (!callId) continue;
    const conversionTime = formatGoogleAdsTimeOrNull(
      pickCanonicalOccurredAt([
        sig.occurred_at as string | null,
        sig.google_conversion_time as string | null,
        sig.created_at as string | null,
      ]),
      ctx.site.timezone
    );
    if (!conversionTime) {
      blockedSignalTimeIds.push(signalId);
      continue;
    }
    const stage = resolveSignalStage(
      (sig.optimization_stage as string | null) ?? null,
      typeof sig.signal_type === 'string' ? sig.signal_type : ''
    );
    if (!stage || stage === 'junk') {
      blockedSignalIds.push(signalId);
      logWarn('OCI_EXPORT_SIGNAL_SKIP_UNKNOWN_STAGE', {
        signal_id: signalId,
        call_id: callId,
        signal_type: (sig.signal_type as string | null) ?? null,
      });
      continue;
    }
    const valueGuard = validateOciSignalConversionValue(sig.optimization_value ?? sig.conversion_value);
    if (!valueGuard.ok) {
      blockedSignalValueIds.push(signalId);
      continue;
    }
    const clickId = String(sig.gclid || sig.wbraid || sig.gbraid || '').trim();
    if (!clickId) continue;
    const orderId = buildOrderId(
      String(sig.google_conversion_name || 'OpsMantik_Contacted'),
      clickId,
      conversionTime,
      `signal_${signalId}`,
      signalId,
      Math.round(valueGuard.normalized * 100)
    );
    const item: GoogleAdsConversionItem = {
      id: `signal_${signalId}`,
      orderId: orderId || `signal_${signalId}`,
      gclid: String(sig.gclid || ''),
      wbraid: String(sig.wbraid || ''),
      gbraid: String(sig.gbraid || ''),
      conversionName: String(sig.google_conversion_name || 'OpsMantik_Contacted'),
      conversionTime,
      conversionValue: valueGuard.normalized,
      conversionCurrency: String(ctx.site.currency || NEUTRAL_CURRENCY),
    };
    signalItems.push(item);
    signalCandidates.push({
      id: item.id,
      groupKey: buildSingleConversionGroupKey(null, callId, signalId),
      gear: stage,
      sortKey: item.conversionTime,
      value: item,
    });
  }

  return { signalItems, signalCandidates, blockedSignalIds, blockedSignalTimeIds, blockedSignalValueIds };
}
