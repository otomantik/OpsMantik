/**
 * Router-side thin wrapper around `upsertMarketingSignal`.
 *
 * **PR-2 ENQUEUE CONTRACT:** This is an **ACTIVE_RUNTIME_RESIDUE**.
 * `marketing_signals` is an audit-only path, NOT a Google upload authority.
 * Google upload authority strictly rests with `offline_conversion_queue`.
 * 
 * This file used to contain the direct INSERT into `marketing_signals`; that logic now
 * lives in `upsert-marketing-signal.ts` (the SSOT helper). All routing side-effects —
 * causalDna branches, log lines, conversion value book-keeping — still happen here so
 * the router remains the single surface that understands `PipelineStage → marketing_signals`
 * from the sync pipeline.
 */

import type { PipelineStage, SignalPayload } from './types';
import { OPSMANTIK_CONVERSION_NAMES } from './conversion-names';
import { buildOptimizationSnapshot } from '@/lib/oci/optimization-contract';
import { loadMarketingSignalEconomics } from '@/lib/oci/marketing-signal-value-ssot';
import { upsertMarketingSignal } from './upsert-marketing-signal';

function normalizeClickSegment(s: string | null | undefined): string | null {
  const v = typeof s === 'string' ? s.trim() : '';
  return v.length > 0 ? v : null;
}

export interface InsertMarketingSignalParams {
  siteId: string;
  callId: string | null;
  traceId: string | null;
  stage: PipelineStage;
  payload: SignalPayload;
}

export async function insertMarketingSignal(params: InsertMarketingSignalParams): Promise<{
  success: boolean;
  signalId?: string | null;
  conversionValue: number;
  causalDna: Record<string, unknown>;
  duplicate?: boolean;
}> {
  const { siteId, callId, traceId, stage, payload } = params;
  const { signalDate, conversionName, gclid, wbraid, gbraid } = payload;

  // 'won' is owned exclusively by the seal path (offline_conversion_queue).
  // contacted / offered / junk → marketing_signals (audit/hash/recovery only); Google script batch = offline_conversion_queue journal only.
  if (stage === 'won') {
    return { success: false, conversionValue: 0, causalDna: {}, duplicate: false };
  }

  const snapshot = buildOptimizationSnapshot({
    stage,
    systemScore: 0,
    modelVersion: 'universal-value-v1',
  });

  const clickNorm = {
    gclid: normalizeClickSegment(gclid ?? null),
    wbraid: normalizeClickSegment(wbraid ?? null),
    gbraid: normalizeClickSegment(gbraid ?? null),
  };
  const hasAnyClickId = Boolean(clickNorm.gclid || clickNorm.wbraid || clickNorm.gbraid);
  if (!hasAnyClickId) {
    return { success: true, signalId: null, conversionValue: 0, causalDna: {} };
  }

  const economics = await loadMarketingSignalEconomics({ siteId, stage, snapshot });
  const conversionValue = economics.conversionValueMajor;

  // Causal DNA logic removed (Lean & Mean)

  const result = await upsertMarketingSignal({
    source: 'router',
    siteId,
    callId,
    traceId,
    stage: stage,
    signalDate,
    snapshot,
    economics,
    clickIds: clickNorm,
    featureSnapshotExtras: { source_detail: 'mizan_marketing_signal_insert' },
    conversionNameOverride: conversionName ?? OPSMANTIK_CONVERSION_NAMES[stage],
  });

  if (!result.success) {
    return { success: false, conversionValue: 0, causalDna: {} };
  }

  if (result.duplicate) {
    return { success: true, conversionValue, causalDna: {}, duplicate: true };
  }

  if (result.skipped) {
    return { success: true, signalId: null, conversionValue, causalDna: {} };
  }

  return {
    success: true,
    signalId: result.signalId ?? null,
    conversionValue,
    causalDna: {},
  };
}

