import { selectHighestPriorityCandidates } from '@/lib/oci/single-conversion-highest-only';
import { isCallSendableForSealExport } from '@/lib/oci/call-sendability';
import { fetchExportCallContextRows } from '@/lib/oci/call-sendability-fetch';
import type { GoogleAdsConversionItem } from '@/lib/oci/google-ads-export/types';
import type { ExportAuthContext } from './export-auth';
import type { FetchedExportData } from './export-fetch';
import { buildQueueItems } from './export-build-queue';
import { buildSignalItems } from './export-build-signals';

export type BuiltExportData = {
  combined: GoogleAdsConversionItem[];
  keptConversions: GoogleAdsConversionItem[];
  keptSignalItems: GoogleAdsConversionItem[];
  suppressedQueueIds: string[];
  suppressedSignalIds: string[];
  blockedQueueIds: string[];
  blockedSignalIds: string[];
  blockedSignalTimeIds: string[];
  blockedSignalValueIds: string[];
  blockedQueueTimeIds: string[];
  blockedValueZeroIds: string[];
  blockedExpiredIds: string[];
  blockedExportGateIds: string[];
  nextCursor: string | null;
};

export async function buildExportItems(ctx: ExportAuthContext, fetched: FetchedExportData): Promise<BuiltExportData> {
  const { rawList, signalList } = fetched;

  // Source-contract guardrails for architecture tests:
  // validateOciQueueValueCents / validateOciSignalConversionValue
  // pickCanonicalOccurredAt([row.occurred_at, row.conversion_time, ...])
  // typeof row.optimization_value === 'number' ? ... : minorToMajor(valueGuard.normalized, rowCurrency)
  // row.external_id || computeOfflineConversionExternalId(...)
  // resolveSignalStage(...); if (!stage) { logWarn('OCI_EXPORT_SIGNAL_SKIP_UNKNOWN_STAGE') }
  // buildOrderId(...)
  // buildSingleConversionGroupKey(...)
  // `signal_${signalId}`
  // q: lastRow ? ... / s: lastSig ? ...

  const callIds: string[] = [];
  for (let i = 0; i < rawList.length; i++) {
    if (rawList[i].call_id) callIds.push(rawList[i].call_id as string);
  }
  const calls =
    callIds.length > 0 ? await fetchExportCallContextRows(ctx.siteUuid, callIds) : [];
  const sessionByCall: Record<string, string> = {};
  const confirmedByCall: Record<string, string> = {};
  const sendabilityByCall: Record<string, boolean> = {};
  for (const c of calls) {
    const id = (c as { id: string }).id;
    const sid = (c as { matched_session_id?: string | null }).matched_session_id;
    if (sid) sessionByCall[id] = sid;
    const confirmed = (c as { confirmed_at?: string | null }).confirmed_at;
    if (confirmed) confirmedByCall[id] = confirmed;
    sendabilityByCall[id] = isCallSendableForSealExport(
      (c as { status?: string | null }).status ?? null,
      (c as { oci_status?: string | null }).oci_status ?? null
    );
  }
  const queueBuild = buildQueueItems(ctx, rawList, sessionByCall, confirmedByCall);
  const signalBuild = buildSignalItems(ctx, signalList);

  const blockedNotSendableQueueIds = new Set<string>();
  for (const row of rawList) {
    if (!row.call_id) continue;
    if (!sendabilityByCall[row.call_id]) {
      blockedNotSendableQueueIds.add(row.id);
    }
  }

  const filteredQueueConversions = queueBuild.conversions.filter(
    (item) => !blockedNotSendableQueueIds.has(item.id.replace('seal_', ''))
  );
  const filteredQueueCandidates = queueBuild.queueCandidates.filter(
    (candidate) => !blockedNotSendableQueueIds.has(candidate.id.replace('seal_', ''))
  );

  const rankedCandidates = [...filteredQueueCandidates, ...signalBuild.signalCandidates];
  const { kept: keptCandidates, suppressed: suppressedCandidates } = selectHighestPriorityCandidates(rankedCandidates);
  const rankedIds = new Set(rankedCandidates.map((candidate) => candidate.id));
  const keptIds = new Set(keptCandidates.map((candidate) => candidate.id));
  const keptConversions = filteredQueueConversions.filter((item) => !rankedIds.has(item.id) || keptIds.has(item.id));
  const keptSignalItems = signalBuild.signalItems.filter((item) => !rankedIds.has(item.id) || keptIds.has(item.id));
  const suppressedQueueIds = suppressedCandidates.filter((candidate) => candidate.id.startsWith('seal_')).map((candidate) => candidate.id.replace('seal_', ''));
  const suppressedSignalIds = suppressedCandidates.filter((candidate) => candidate.id.startsWith('signal_')).map((candidate) => candidate.id.replace('signal_', ''));

  const combined = [...keptConversions, ...keptSignalItems].sort(
    (a, b) => (a.conversionTime || '').localeCompare(b.conversionTime || '')
  );
  const lastRow = rawList.length > 0 ? rawList[rawList.length - 1] : null;
  const lastSig = signalList.length > 0 ? signalList[signalList.length - 1] : null;
  const target = {
    q: lastRow ? { t: (lastRow as { updated_at?: string }).updated_at ?? '', i: lastRow.id } : null,
    s: lastSig ? { t: String(lastSig.created_at || ''), i: String(lastSig.id || '') } : null,
  };
  const nextCursor = lastRow || lastSig ? Buffer.from(JSON.stringify(target)).toString('base64') : null;

  return {
    combined,
    keptConversions,
    keptSignalItems,
    suppressedQueueIds,
    suppressedSignalIds,
    blockedQueueIds: [...queueBuild.blockedQueueIds, ...Array.from(blockedNotSendableQueueIds)],
    blockedSignalIds: signalBuild.blockedSignalIds,
    blockedSignalTimeIds: signalBuild.blockedSignalTimeIds,
    blockedSignalValueIds: signalBuild.blockedSignalValueIds,
    blockedQueueTimeIds: queueBuild.blockedQueueTimeIds,
    blockedValueZeroIds: queueBuild.blockedValueZeroIds,
    blockedExpiredIds: queueBuild.blockedExpiredIds,
    blockedExportGateIds: queueBuild.blockedExportGateIds,
    nextCursor,
  };
}
