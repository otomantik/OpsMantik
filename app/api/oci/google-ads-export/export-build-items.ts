import { selectCoexistentFunnelExportCandidates } from '@/lib/oci/single-conversion-highest-only';
import { isQueueRowSendableForGoogleAdsExport } from '@/lib/oci/call-sendability';
import type { GoogleAdsConversionItem } from '@/lib/oci/google-ads-export/types';
import type { ExportAuthContext } from './export-auth';
import type { FetchedExportData } from './export-fetch';
import type { PipelineStats } from './export-preview-diagnostics';
import { normalizeServerHashedPhone } from '@/lib/oci/hashed-phone-courier';
import {
  buildQueueItems,
  type ExportGateBlockReason,
  type HashedPhoneAttribution,
  type QueueCurrencyDiagnostics,
  type QueueHashedPhoneDiagnostics,
} from './export-build-queue';

/** PR-9H.8: maps from atomic JIT row — no second `calls` fetch (export RPC is single snapshot). */
function buildJitMapsFromRows(rawList: FetchedExportData['rawList']): {
  sessionByCall: Record<string, string>;
  intentCreatedByCall: Record<string, string>;
  callSendabilityCtxById: Map<string, { status: string | null; oci_status: string | null }>;
  callerPhoneHashByCall: Record<string, string | undefined>;
} {
  const sessionByCall: Record<string, string> = {};
  const intentCreatedByCall: Record<string, string> = {};
  const callSendabilityCtxById = new Map<string, { status: string | null; oci_status: string | null }>();
  const callerPhoneHashByCall: Record<string, string | undefined> = {};

  for (const row of rawList) {
    const cid = row.call_id;
    if (!cid) continue;
    const ms = row.jit_call_matched_session_id;
    if (ms) sessionByCall[cid] = ms;
    const ca = row.jit_call_created_at;
    if (ca) intentCreatedByCall[cid] = ca;
    callSendabilityCtxById.set(cid, {
      status: row.jit_call_status ?? null,
      oci_status: row.jit_call_oci_status ?? null,
    });
    const h = row.jit_caller_phone_hash_sha256;
    const t = typeof h === 'string' ? h.trim() : '';
    if (t) callerPhoneHashByCall[cid] = t;
  }

  return { sessionByCall, intentCreatedByCall, callSendabilityCtxById, callerPhoneHashByCall };
}

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
  blockedExportGateReasonByQueueId: Record<string, ExportGateBlockReason>;
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

  const { sessionByCall, intentCreatedByCall, callSendabilityCtxById, callerPhoneHashByCall } =
    buildJitMapsFromRows(rawList);
  const queueBuild = buildQueueItems(ctx, rawList, sessionByCall, intentCreatedByCall, callerPhoneHashByCall);

  const blockedNotSendableQueueIds = new Set<string>();
  for (const row of rawList) {
    if (!row.call_id) continue;
    const ctxRow = callSendabilityCtxById.get(row.call_id);
    const sendable = ctxRow
      ? isQueueRowSendableForGoogleAdsExport(row.action ?? null, ctxRow.status, ctxRow.oci_status)
      : false;
    if (!sendable) {
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
  /** Full journal page ⇒ cursor; short page ⇒ end of queue (fixes false hasNextPage when nextCursor was always set). */
  const pageLimit = Math.min(1000, Math.max(1, ctx.pageLimit));
  const journalPageFull = rawList.length > 0 && rawList.length >= pageLimit;
  const nextCursor =
    lastRow && journalPageFull
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
    blockedExportGateReasonByQueueId: queueBuild.blockedExportGateReasonByQueueId,
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
