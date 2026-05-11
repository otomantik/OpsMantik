import { selectCoexistentFunnelExportCandidates } from '@/lib/oci/single-conversion-highest-only';
import { isCallSendableForSealExport } from '@/lib/oci/call-sendability';
import { fetchExportCallContextRows } from '@/lib/oci/call-sendability-fetch';
import type { GoogleAdsConversionItem } from '@/lib/oci/google-ads-export/types';
import type { ExportAuthContext } from './export-auth';
import type { FetchedExportData } from './export-fetch';
import type { PipelineStats } from './export-preview-diagnostics';
import { normalizeServerHashedPhone } from '@/lib/oci/hashed-phone-courier';
import {
  buildQueueItems,
  type HashedPhoneAttribution,
  type QueueCurrencyDiagnostics,
  type QueueHashedPhoneDiagnostics,
} from './export-build-queue';

/** Exported for PR-9H.7D unit tests (aggregate diagnostics only). */
export function finalizeReturnedPhoneDiagnostics(
  combined: GoogleAdsConversionItem[],
  attributions: HashedPhoneAttribution[],
  base: QueueHashedPhoneDiagnostics
): QueueHashedPhoneDiagnostics {
  const combinedIds = new Set(combined.map((i) => i.id.replace(/^seal_/, '')));
  let exported = 0;
  let missing = 0;
  for (const it of combined) {
    const hp = normalizeServerHashedPhone(it.hashedPhoneNumber ?? it.hashed_phone_number);
    if (hp) exported += 1;
    else missing += 1;
  }
  const hashed_phone_source_counts: Record<string, number> = {};
  const itemByQueueId = new Map(combined.map((it) => [it.id.replace(/^seal_/, ''), it]));
  for (const a of attributions) {
    if (!combinedIds.has(a.queueId)) continue;
    const it = itemByQueueId.get(a.queueId);
    const hp = it ? normalizeServerHashedPhone(it.hashedPhoneNumber ?? it.hashed_phone_number) : null;
    if (!hp) continue;
    const key = a.source ?? 'unknown';
    hashed_phone_source_counts[key] = (hashed_phone_source_counts[key] ?? 0) + 1;
  }
  return {
    ...base,
    hashed_phone_exported_count: exported,
    hashed_phone_missing_count: missing,
    hashed_phone_source_counts,
  };
}

export type BuiltExportData = {
  combined: GoogleAdsConversionItem[];
  keptConversions: GoogleAdsConversionItem[];
  suppressedQueueIds: string[];
  blockedQueueIds: string[];
  blockedQueueTimeIds: string[];
  blockedValueZeroIds: string[];
  blockedExpiredIds: string[];
  blockedExportGateIds: string[];
  blockedCurrencyIds: string[];
  blockedMissingConversionActionIds: string[];
  /** Explicit sendability skips (merged into blockedQueueIds for legacy counts). */
  callNotSendableQueueIds: string[];
  pipelineStats: PipelineStats;
  nextCursor: string | null;
  hashedPhoneDiagnostics: QueueHashedPhoneDiagnostics;
  currencyDiagnostics: QueueCurrencyDiagnostics;
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
  const callerPhoneHashByCall: Record<string, string | undefined> = {};
  for (const c of calls) {
    const id = (c as { id: string }).id;
    const h = (c as { caller_phone_hash_sha256?: string | null }).caller_phone_hash_sha256;
    const t = typeof h === 'string' ? h.trim() : '';
    if (t) callerPhoneHashByCall[id] = t;
  }
  const queueBuild = buildQueueItems(ctx, rawList, sessionByCall, intentCreatedByCall, callerPhoneHashByCall);

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
  const { kept: keptCandidates, suppressed: suppressedCandidates } =
    selectCoexistentFunnelExportCandidates(rankedCandidates);
  const rankedIds = new Set(rankedCandidates.map((candidate) => candidate.id));
  const keptIds = new Set(keptCandidates.map((candidate) => candidate.id));
  const keptConversions = filteredQueueConversions.filter((item) => !rankedIds.has(item.id) || keptIds.has(item.id));
  const suppressedQueueIds = suppressedCandidates
    .filter((candidate) => candidate.id.startsWith('seal_'))
    .map((candidate) => candidate.id.replace('seal_', ''));

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

  const callNotSendableQueueIds = [...blockedNotSendableQueueIds];
  const pipelineStats: PipelineStats = {
    fetch_row_count: rawList.length,
    build_queue_conversions_count: queueBuild.conversions.length,
    after_call_sendability_filter_count: filteredQueueConversions.length,
    after_highest_gear_returned_count: combined.length,
  };

  return {
    combined,
    keptConversions,
    suppressedQueueIds,
    blockedQueueIds: [...queueBuild.blockedQueueIds, ...callNotSendableQueueIds],
    blockedQueueTimeIds: queueBuild.blockedQueueTimeIds,
    blockedValueZeroIds: queueBuild.blockedValueZeroIds,
    blockedExpiredIds: queueBuild.blockedExpiredIds,
    blockedExportGateIds: queueBuild.blockedExportGateIds,
    blockedCurrencyIds: queueBuild.blockedCurrencyIds,
    blockedMissingConversionActionIds: queueBuild.blockedMissingConversionActionIds,
    callNotSendableQueueIds,
    pipelineStats,
    nextCursor,
    hashedPhoneDiagnostics: finalizeReturnedPhoneDiagnostics(
      combined,
      queueBuild.hashedPhoneAttributions,
      queueBuild.hashedPhoneDiagnostics
    ),
    currencyDiagnostics: queueBuild.currencyDiagnostics,
  };
}
