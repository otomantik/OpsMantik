/**
 * Batch backfill: missing OpsMantik_Contacted / OpsMantik_Offered rows when click IDs exist.
 *
 * Time source (plan): `planPrecursorBackfillStages` — ledger first, hybrid when ledger partial,
 * snapshot fallback when ledger empty. Google conversion time is never backfill job `NOW()`.
 */

import { adminClient } from '@/lib/supabase/admin';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/domain/mizan-mantik/conversion-names';
import { upsertMarketingSignal } from '@/lib/domain/mizan-mantik/upsert-marketing-signal';
import { buildOptimizationSnapshot } from '@/lib/oci/optimization-contract';
import { loadMarketingSignalEconomics } from '@/lib/oci/marketing-signal-value-ssot';
import type { OptimizationStage } from '@/lib/oci/optimization-contract';
import { planPrecursorBackfillStages, type BackfillTimeSource } from '@/lib/oci/precursor-backfill-plan';
import type { PipelineStage } from '@/lib/domain/mizan-mantik/types';

export interface PrecursorBackfillParams {
  siteId: string;
  limit: number;
  dryRun: boolean;
}

export interface PrecursorBackfillResult {
  examined: number;
  upsertAttempts: number;
  inserted: number;
  duplicates: number;
  skippedNoClick: number;
  errors: number;
  ledgerBackedAttempts: number;
  hybridSnapshotAttempts: number;
  fallbackSnapshotAttempts: number;
}

function parseIsoToDate(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`INVALID_OCCURRED_AT:${iso}`);
  }
  return d;
}

async function firstLedgerTimes(
  siteId: string,
  callId: string
): Promise<{ contactedIso: string | null; offeredIso: string | null }> {
  const { data, error } = await adminClient
    .from('call_funnel_ledger')
    .select('event_type, occurred_at')
    .eq('site_id', siteId)
    .eq('call_id', callId)
    .in('event_type', ['contacted', 'offered'])
    .order('occurred_at', { ascending: true });

  if (error) {
    return { contactedIso: null, offeredIso: null };
  }

  let contactedIso: string | null = null;
  let offeredIso: string | null = null;
  for (const row of Array.isArray(data) ? data : []) {
    const et = String((row as { event_type?: string }).event_type ?? '');
    const oa = (row as { occurred_at?: string }).occurred_at;
    if (!oa) continue;
    if (et === 'contacted' && !contactedIso) contactedIso = oa;
    if (et === 'offered' && !offeredIso) offeredIso = oa;
  }
  return { contactedIso, offeredIso };
}

function bumpSourceCounter(result: PrecursorBackfillResult, source: BackfillTimeSource) {
  if (source === 'ledger') result.ledgerBackedAttempts++;
  else if (source === 'call_snapshot_hybrid') result.hybridSnapshotAttempts++;
  else result.fallbackSnapshotAttempts++;
}

export async function runPrecursorSignalBackfill(
  params: PrecursorBackfillParams
): Promise<PrecursorBackfillResult> {
  const limit = Math.min(200, Math.max(1, params.limit));
  const result: PrecursorBackfillResult = {
    examined: 0,
    upsertAttempts: 0,
    inserted: 0,
    duplicates: 0,
    skippedNoClick: 0,
    errors: 0,
    ledgerBackedAttempts: 0,
    hybridSnapshotAttempts: 0,
    fallbackSnapshotAttempts: 0,
  };

  const { data: calls, error } = await adminClient
    .from('calls')
    .select('id, site_id, status, lead_score, gclid, wbraid, gbraid, confirmed_at, created_at')
    .eq('site_id', params.siteId)
    .in('status', ['qualified', 'real', 'confirmed'])
    .or('gclid.not.is.null,wbraid.not.is.null,gbraid.not.is.null')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  const list = Array.isArray(calls) ? calls : [];
  result.examined = list.length;

  for (const row of list) {
    const callId = (row as { id: string }).id;
    const status = (row as { status?: string }).status ?? null;
    const leadScore = (row as { lead_score?: number | null }).lead_score ?? null;
    const gclid = (row as { gclid?: string | null }).gclid ?? null;
    const wbraid = (row as { wbraid?: string | null }).wbraid ?? null;
    const gbraid = (row as { gbraid?: string | null }).gbraid ?? null;
    const createdAt = String((row as { created_at: string }).created_at);
    const confirmedAt = (row as { confirmed_at?: string | null }).confirmed_at ?? null;

    const hasClick = Boolean(
      (gclid ?? '').trim() || (wbraid ?? '').trim() || (gbraid ?? '').trim()
    );
    if (!hasClick) {
      result.skippedNoClick++;
      continue;
    }

    const lt = await firstLedgerTimes(params.siteId, callId);
    const stages = planPrecursorBackfillStages({
      ledgerContacted: lt.contactedIso,
      ledgerOffered: lt.offeredIso,
      callStatus: status,
      confirmedAt,
      createdAt,
    });

    if (stages.length === 0) continue;

    for (const plan of stages) {
      const convName = OPSMANTIK_CONVERSION_NAMES[plan.stage as OptimizationStage];
      const { data: existing } = await adminClient
        .from('marketing_signals')
        .select('id')
        .eq('site_id', params.siteId)
        .eq('call_id', callId)
        .eq('google_conversion_name', convName)
        .limit(1);

      if (existing && existing.length > 0) {
        continue;
      }

      if (params.dryRun) {
        result.upsertAttempts++;
        bumpSourceCounter(result, plan.source);
        continue;
      }

      const signalDate = parseIsoToDate(plan.occurredIso);
      const snapshot = buildOptimizationSnapshot({
        stage: plan.stage,
        systemScore: leadScore,
        modelVersion: 'backfill-precursor-v1',
      });

      result.upsertAttempts++;
      bumpSourceCounter(result, plan.source);

      const economics = await loadMarketingSignalEconomics({
        siteId: params.siteId,
        stage: plan.stage as Exclude<PipelineStage, 'won'>,
        snapshot,
      });

      const up = await upsertMarketingSignal({
        source: 'router',
        siteId: params.siteId,
        callId,
        traceId: null,
        stage: plan.stage as Exclude<PipelineStage, 'won'>,
        signalDate,
        snapshot,
        economics,
        clickIds: { gclid, wbraid, gbraid },
        featureSnapshotExtras: {
          source_detail: 'precursor_backfill',
          backfill_time_source: plan.source,
        },
        causalDna: {
          branch: 'precursor_backfill',
          call_status: status,
          backfill_time_source: plan.source,
        },
      });

      if (up.success && up.signalId && !up.duplicate) {
        result.inserted++;
      } else if (up.duplicate) {
        result.duplicates++;
      } else if (up.skipped) {
        result.skippedNoClick++;
      } else {
        result.errors++;
      }
    }
  }

  return result;
}
