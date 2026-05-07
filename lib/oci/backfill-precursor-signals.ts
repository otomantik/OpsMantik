/**
 * Batch backfill: missing OpsMantik_Contacted / OpsMantik_Offered rows when click IDs exist.
 *
 * Time source (plan): `planPrecursorBackfillStages` — ledger first, hybrid when ledger partial,
 * snapshot fallback when ledger empty. Google conversion time is never backfill job `NOW()`.
 */

import { adminClient } from '@/lib/supabase/admin';
import { buildOptimizationSnapshot } from '@/lib/oci/optimization-contract';
import { loadMarketingSignalEconomics } from '@/lib/oci/marketing-signal-value-ssot';
import type { OptimizationStage } from '@/lib/oci/optimization-contract';
import { planPrecursorBackfillStages, type BackfillTimeSource } from '@/lib/oci/precursor-backfill-plan';
import type { PipelineStage } from '@/lib/oci/signal-types';
import { ensureMarketingSignalQueueParity } from '@/lib/oci/marketing-signal-queue-parity';

export interface PrecursorBackfillParams {
  siteId: string;
  limit: number;
  dryRun: boolean;
}

export interface PrecursorBackfillResult {
  examined: number;
  queueAttempts: number;
  queued: number;
  queueDuplicates: number;
  skippedNoClick: number;
  errors: number;
  ledgerBackedAttempts: number;
  hybridSnapshotAttempts: number;
  fallbackSnapshotAttempts: number;
  parityQueueEnqueued: number;
  parityQueueDuplicates: number;
  parityQueueSkippedConsent: number;
  parityQueueErrors: number;
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
    queueAttempts: 0,
    queued: 0,
    queueDuplicates: 0,
    skippedNoClick: 0,
    errors: 0,
    ledgerBackedAttempts: 0,
    hybridSnapshotAttempts: 0,
    fallbackSnapshotAttempts: 0,
    parityQueueEnqueued: 0,
    parityQueueDuplicates: 0,
    parityQueueSkippedConsent: 0,
    parityQueueErrors: 0,
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
      if (params.dryRun) {
        result.queueAttempts++;
        bumpSourceCounter(result, plan.source);
        continue;
      }

      const signalDate = parseIsoToDate(plan.occurredIso);
      const snapshot = buildOptimizationSnapshot({
        stage: plan.stage,
        systemScore: leadScore,
        modelVersion: 'backfill-precursor-v1',
      });

      result.queueAttempts++;
      bumpSourceCounter(result, plan.source);

      const economics = await loadMarketingSignalEconomics({
        siteId: params.siteId,
        stage: plan.stage as Exclude<PipelineStage, 'won'>,
        snapshot,
      });

      const parity = await ensureMarketingSignalQueueParity({
        siteId: params.siteId,
        callId,
        stage: plan.stage as Exclude<PipelineStage, 'won'>,
        occurredAt: signalDate,
        leadScore: Number.isFinite(leadScore as number) ? Number(leadScore) : 0,
        currency: economics.currencyCode,
        gclid,
        wbraid,
        gbraid,
        source: 'precursor_backfill_queue_only',
        consentState: 'unknown',
        traceId: null,
      });
      if (parity.reasonCode === 'PARITY_QUEUE_ENQUEUED') {
        result.queued++;
        result.parityQueueEnqueued++;
      } else if (parity.reasonCode === 'PARITY_QUEUE_DUPLICATE') {
        result.queueDuplicates++;
        result.parityQueueDuplicates++;
      } else if (parity.reasonCode === 'PARITY_CONSENT_MISSING') {
        result.parityQueueSkippedConsent++;
      } else {
        result.parityQueueErrors++;
        result.errors++;
      }
    }
  }

  return result;
}
