import { selectHighestPriorityCandidates } from '@/lib/oci/single-conversion-highest-only';
import { isCallSendableForSealExport } from '@/lib/oci/call-sendability';
import { fetchExportCallContextRows } from '@/lib/oci/call-sendability-fetch';
import type { GoogleAdsConversionItem } from '@/lib/oci/google-ads-export/types';
import type { ExportAuthContext } from './export-auth';
import type { FetchedExportData } from './export-fetch';
import { buildQueueItems } from './export-build-queue';

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

/** Journal-only export: no legacy marketing_signals stream. */
export async function buildExportItems(ctx: ExportAuthContext, fetched: FetchedExportData): Promise<BuiltExportData> {
  const { rawList } = fetched;

  const callIds: string[] = [];
  for (let i = 0; i < rawList.length; i++) {
    if (rawList[i].call_id) callIds.push(rawList[i].call_id as string);
  }
  const calls =
    callIds.length > 0 ? await fetchExportCallContextRows(ctx.siteUuid, callIds) : [];
  const sessionByCall: Record<string, string> = {};
  const intentCreatedByCall: Record<string, string> = {};
  const sendabilityByCall: Record<string, boolean> = {};
  for (const c of calls) {
    const id = (c as { id: string }).id;
    const sid = (c as { matched_session_id?: string | null }).matched_session_id;
    if (sid) sessionByCall[id] = sid;
    const createdAt = (c as { created_at?: string | null }).created_at;
    if (createdAt) intentCreatedByCall[id] = createdAt;
    sendabilityByCall[id] = isCallSendableForSealExport(
      (c as { status?: string | null }).status ?? null,
      (c as { oci_status?: string | null }).oci_status ?? null
    );
  }
  const queueBuild = buildQueueItems(ctx, rawList, sessionByCall, intentCreatedByCall);

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

  const rankedCandidates = [...filteredQueueCandidates];
  const { kept: keptCandidates, suppressed: suppressedCandidates } = selectHighestPriorityCandidates(rankedCandidates);
  const rankedIds = new Set(rankedCandidates.map((candidate) => candidate.id));
  const keptIds = new Set(keptCandidates.map((candidate) => candidate.id));
  const keptConversions = filteredQueueConversions.filter((item) => !rankedIds.has(item.id) || keptIds.has(item.id));
  const keptSignalItems: GoogleAdsConversionItem[] = [];
  const suppressedQueueIds = suppressedCandidates
    .filter((candidate) => candidate.id.startsWith('seal_'))
    .map((candidate) => candidate.id.replace('seal_', ''));
  const suppressedSignalIds: string[] = [];

  const combined = [...keptConversions].sort(
    (a, b) => (a.conversionTime || '').localeCompare(b.conversionTime || '')
  );
  const lastRow = rawList.length > 0 ? rawList[rawList.length - 1] : null;
  const nextCursor = lastRow
    ? Buffer.from(
        JSON.stringify({
          q: { t: (lastRow as { updated_at?: string }).updated_at ?? '', i: lastRow.id },
        })
      ).toString('base64')
    : null;

  return {
    combined,
    keptConversions,
    keptSignalItems,
    suppressedQueueIds,
    suppressedSignalIds,
    blockedQueueIds: [...queueBuild.blockedQueueIds, ...Array.from(blockedNotSendableQueueIds)],
    blockedSignalIds: [],
    blockedSignalTimeIds: [],
    blockedSignalValueIds: [],
    blockedQueueTimeIds: queueBuild.blockedQueueTimeIds,
    blockedValueZeroIds: queueBuild.blockedValueZeroIds,
    blockedExpiredIds: queueBuild.blockedExpiredIds,
    blockedExportGateIds: queueBuild.blockedExportGateIds,
    nextCursor,
  };
}
