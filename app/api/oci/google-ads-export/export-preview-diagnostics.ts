/**
 * PR-9H.5B / PR-9H.6 — Extended preview diagnostics for markAsExported=false (PEEK).
 * No raw gclid/wbraid/gbraid values — only booleans and aggregates.
 */
import type { GoogleAdsConversionItem, QueueRow } from '@/lib/oci/google-ads-export/types';
import type { QueueCurrencyDiagnostics, QueueHashedPhoneDiagnostics } from './export-build-queue';
import {
  evaluateSignalReadiness,
  type UserIdentifiersPayload,
} from '@/lib/oci/intent-conversion-journal-contract';

export type PipelineStats = {
  fetch_row_count: number;
  build_queue_conversions_count: number;
  after_call_sendability_filter_count: number;
  after_highest_gear_returned_count: number;
};

export type SkipSetsForPreview = {
  suppressedQueueIds: string[];
  blockedQueueTimeIds: string[];
  blockedValueZeroIds: string[];
  blockedExpiredIds: string[];
  blockedExportGateIds: string[];
  blockedMissingConversionActionIds: string[];
  combined: GoogleAdsConversionItem[];
};

function rowById(rows: QueueRow[]): Map<string, QueueRow> {
  const m = new Map<string, QueueRow>();
  for (const r of rows) {
    m.set(r.id, r);
  }
  return m;
}

function actionLabel(row: QueueRow | undefined): string {
  const a = row?.action?.trim();
  return a && a.length > 0 ? a : '(null)';
}

function statusLabel(row: QueueRow | undefined): string {
  const s = row?.status?.trim();
  return s && s.length > 0 ? s : '(null)';
}

/** Boolean-only click shape bucket for diagnostics (no raw ids). */
export function clickAvailabilityBucket(row: QueueRow | undefined): string {
  if (!row) return 'unknown_row';
  const g = Boolean(row.gclid?.trim());
  const w = Boolean(row.wbraid?.trim());
  const b = Boolean(row.gbraid?.trim());
  return `gclid:${g}_wbraid:${w}_gbraid:${b}`;
}

function userIdentifiersFromRow(row: QueueRow): UserIdentifiersPayload | null {
  const u = row.user_identifiers;
  if (!u || typeof u !== 'object') return null;
  const o = u as Record<string, unknown>;
  const hashed_email = typeof o.hashed_email === 'string' ? o.hashed_email.trim() : undefined;
  const hashed_phone = typeof o.hashed_phone === 'string' ? o.hashed_phone.trim() : undefined;
  if (!hashed_email && !hashed_phone) return null;
  return {
    hashed_email,
    hashed_phone,
    normalization_version:
      typeof o.normalization_version === 'string' ? o.normalization_version : 'unknown',
    consent:
      typeof o.consent === 'object' && o.consent !== null
        ? (o.consent as UserIdentifiersPayload['consent'])
        : undefined,
  };
}

function tallyIds(ids: string[], byId: Map<string, QueueRow>, keyFn: (row: QueueRow | undefined) => string): Record<string, number> {
  const m = new Map<string, number>();
  for (const id of ids) {
    const row = byId.get(id);
    const k = keyFn(row);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
}

function tallyIdsClickBucket(ids: string[], byId: Map<string, QueueRow>): Record<string, number> {
  const m = new Map<string, number>();
  for (const id of ids) {
    const row = byId.get(id);
    const k = clickAvailabilityBucket(row);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
}

function queueIdFromItemId(itemId: string): string {
  return itemId.startsWith('seal_') ? itemId.slice(5) : itemId;
}

function providerPathLabel(row: QueueRow | undefined): string {
  const p = row?.provider_path?.trim();
  return p && p.length > 0 ? p : 'google_ads_script_v1';
}

/**
 * Single primary skip reason per row (priority order matches build pipeline).
 */
function classifySkipReason(
  queueId: string,
  skip: SkipSetsForPreview,
  callNotSendable: Set<string>
):
  | 'missing_conversion_action'
  | 'export_gate_call_id_required'
  | 'invalid_conversion_time'
  | 'invalid_value_cents'
  | 'invalid_value_non_positive'
  | 'call_not_sendable'
  | 'suppressed_by_higher_gear'
  | 'unknown' {
  if (skip.blockedMissingConversionActionIds.includes(queueId)) return 'missing_conversion_action';
  if (skip.blockedExportGateIds.includes(queueId)) return 'export_gate_call_id_required';
  if (skip.blockedQueueTimeIds.includes(queueId)) return 'invalid_conversion_time';
  if (skip.blockedValueZeroIds.includes(queueId)) return 'invalid_value_cents';
  if (skip.blockedExpiredIds.includes(queueId)) return 'invalid_value_non_positive';
  if (callNotSendable.has(queueId)) return 'call_not_sendable';
  if (skip.suppressedQueueIds.includes(queueId)) return 'suppressed_by_higher_gear';
  return 'unknown';
}

function buildSignalAvailabilityCounts(rows: QueueRow[]): Record<string, number> {
  const keys = {
    has_gclid: 0,
    has_wbraid: 0,
    has_gbraid: 0,
    has_hashed_phone: 0,
    has_hashed_email: 0,
    has_external_id: 0,
  };
  for (const row of rows) {
    if (row.gclid?.trim()) keys.has_gclid += 1;
    if (row.wbraid?.trim()) keys.has_wbraid += 1;
    if (row.gbraid?.trim()) keys.has_gbraid += 1;
    const uid = userIdentifiersFromRow(row);
    if (uid?.hashed_phone) keys.has_hashed_phone += 1;
    if (uid?.hashed_email) keys.has_hashed_email += 1;
    if (row.external_id?.trim()) keys.has_external_id += 1;
  }
  return keys;
}

function buildScriptAndApiCounts(rows: QueueRow[]): {
  script_v1_supported_counts: { gclid_ready: number; gclid_not_ready: number };
  api_supported_counts: { click_id_capable: number; enhanced_capable: number };
} {
  let gclidReady = 0;
  let gclidNotReady = 0;
  let clickCap = 0;
  let enhancedCap = 0;
  for (const row of rows) {
    const uid = userIdentifiersFromRow(row);
    const r = evaluateSignalReadiness({
      gclid: row.gclid,
      wbraid: row.wbraid,
      gbraid: row.gbraid,
      userIdentifiers: uid,
    });
    if (r.scriptV1GclidReady) gclidReady += 1;
    else gclidNotReady += 1;
    if (r.apiClickIdReady) clickCap += 1;
    if (r.enhancedConversionsLeadsReady) enhancedCap += 1;
  }
  return {
    script_v1_supported_counts: { gclid_ready: gclidReady, gclid_not_ready: gclidNotReady },
    api_supported_counts: { click_id_capable: clickCap, enhanced_capable: enhancedCap },
  };
}

export type PreviewDiagnosticsExtension = {
  built_count: number;
  hashed_phone_available_count: number;
  hashed_phone_invalid_count: number;
  hashed_phone_candidate_count: number;
  hashed_phone_exported_count: number;
  hashed_phone_missing_count: number;
  hashed_phone_source_counts: Record<string, number>;
  enhanced_signal_available_count: number;
  currency_missing_count: number;
  currency_unexpected_count: number;
  currency_defaulted_count: number;
  pipeline_stats: PipelineStats;
  skip_by_action: Record<string, number>;
  skip_by_status: Record<string, number>;
  skip_by_click_id_availability: Record<string, number>;
  skip_by_reason_detail: Record<string, number>;
  skip_by_provider_path: Record<string, number>;
  returned_action_counts: Record<string, number>;
  signal_availability_counts: Record<string, number>;
  script_v1_supported_counts: { gclid_ready: number; gclid_not_ready: number };
  api_supported_counts: { click_id_capable: number; enhanced_capable: number };
};

export function buildPreviewDiagnosticsExtension(
  rawList: QueueRow[],
  skip: SkipSetsForPreview,
  pipelineStats: PipelineStats,
  callNotSendableQueueIds: string[],
  phoneDiag: QueueHashedPhoneDiagnostics,
  currencyDiag: QueueCurrencyDiagnostics
): PreviewDiagnosticsExtension {
  const byId = rowById(rawList);
  const callNotSendable = new Set(callNotSendableQueueIds);

  const returnedQueueIds = new Set(skip.combined.map((c) => queueIdFromItemId(c.id)));
  const skippedIds = rawList.map((r) => r.id).filter((id) => !returnedQueueIds.has(id));

  const skipReasonDetailCounts = new Map<string, number>();
  for (const id of skippedIds) {
    const reason = classifySkipReason(id, skip, callNotSendable);
    skipReasonDetailCounts.set(reason, (skipReasonDetailCounts.get(reason) ?? 0) + 1);
  }

  const returnedActionCounts: Record<string, number> = {};
  for (const item of skip.combined) {
    const qid = queueIdFromItemId(item.id);
    const row = byId.get(qid);
    const a = actionLabel(row);
    returnedActionCounts[a] = (returnedActionCounts[a] ?? 0) + 1;
  }

  const signalBlock = buildScriptAndApiCounts(rawList);

  return {
    built_count: pipelineStats.build_queue_conversions_count,
    hashed_phone_available_count: phoneDiag.hashed_phone_available_count,
    hashed_phone_invalid_count: phoneDiag.hashed_phone_invalid_count,
    hashed_phone_candidate_count: phoneDiag.hashed_phone_candidate_count,
    hashed_phone_exported_count: phoneDiag.hashed_phone_exported_count,
    hashed_phone_missing_count: phoneDiag.hashed_phone_missing_count,
    hashed_phone_source_counts: phoneDiag.hashed_phone_source_counts,
    enhanced_signal_available_count: phoneDiag.enhanced_signal_available_count,
    currency_missing_count: currencyDiag.currency_missing_count,
    currency_unexpected_count: currencyDiag.currency_unexpected_count,
    currency_defaulted_count: currencyDiag.currency_defaulted_count,
    pipeline_stats: pipelineStats,
    skip_by_action: tallyIds(skippedIds, byId, (r) => actionLabel(r)),
    skip_by_status: tallyIds(skippedIds, byId, (r) => statusLabel(r)),
    skip_by_click_id_availability: tallyIdsClickBucket(skippedIds, byId),
    skip_by_reason_detail: Object.fromEntries([...skipReasonDetailCounts.entries()].sort((a, b) => b[1] - a[1])),
    skip_by_provider_path: tallyIds(skippedIds, byId, (r) => providerPathLabel(r)),
    returned_action_counts: returnedActionCounts,
    signal_availability_counts: buildSignalAvailabilityCounts(rawList),
    script_v1_supported_counts: signalBlock.script_v1_supported_counts,
    api_supported_counts: signalBlock.api_supported_counts,
  };
}
