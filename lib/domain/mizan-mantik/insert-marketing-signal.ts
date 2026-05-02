/**
 * Router-side thin wrapper around `upsertMarketingSignal`.
 *
 * This file used to contain the direct INSERT into `marketing_signals`; that logic now
 * lives in `upsert-marketing-signal.ts` (the SSOT helper). All routing side-effects —
 * causalDna branches, log lines, conversion value book-keeping — still happen here so
 * the router remains the single surface that understands `PipelineStage → marketing_signals`
 * from the sync pipeline.
 */

import type { PipelineStage, SignalPayload } from './types';
import type { CausalDna } from './causal-dna';
import { appendBranch, toJsonb } from './causal-dna';
import { OPSMANTIK_CONVERSION_NAMES } from './conversion-names';
import { logShadowDecision, appendCausalDnaLedgerSafe } from './shared';
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
  dna: CausalDna;
  entropyScore: number;
  uncertaintyBit: boolean | null;
}

export async function insertMarketingSignal(params: InsertMarketingSignalParams): Promise<{
  success: boolean;
  signalId?: string | null;
  conversionValue: number;
  causalDna: Record<string, unknown>;
  duplicate?: boolean;
}> {
  const { siteId, callId, traceId, stage, payload, dna, entropyScore, uncertaintyBit } = params;
  const { signalDate, conversionName, gclid, wbraid, gbraid } = payload;

  // 'won' is owned exclusively by the seal path (offline_conversion_queue).
  // contacted / offered / junk → marketing_signals → Google (OCI script birleşik export).
  if (stage === 'won') {
    return { success: false, conversionValue: 0, causalDna: toJsonb(dna), duplicate: false };
  }

  const snapshot = buildOptimizationSnapshot({
    stage,
    systemScore: resolveSignalSystemScore(payload),
    modelVersion: 'universal-value-v1',
  });

  const clickNorm = {
    gclid: normalizeClickSegment(gclid ?? null),
    wbraid: normalizeClickSegment(wbraid ?? null),
    gbraid: normalizeClickSegment(gbraid ?? null),
  };
  const hasAnyClickId = Boolean(clickNorm.gclid || clickNorm.wbraid || clickNorm.gbraid);
  if (!hasAnyClickId) {
    const dnaSkip = appendBranch(
      dna,
      `${stage}_marketing_signals_skip`,
      [],
      { signalDate: signalDate.toISOString() },
      { reason: 'missing_click_ids' }
    );
    return { success: true, signalId: null, conversionValue: 0, causalDna: toJsonb(dnaSkip) };
  }

  const economics = await loadMarketingSignalEconomics({ siteId, stage, snapshot });
  const finalCents = economics.expectedValueCents;
  const conversionValue = economics.conversionValueMajor;

  logShadowDecision(siteId, 'signal', null, 'UNIVERSAL_VALUE', 'SSOT marketing signal economics', {
    stage: snapshot.optimizationStage,
    value_cents: finalCents,
    value_source: economics.valueSource,
    quality_factor: snapshot.qualityFactor,
  });

  let dnaOut = appendBranch(
    dna,
    `${stage}_marketing_signals`,
    ['auth', 'idempotency', 'usage'],
    { signalDate: signalDate.toISOString() },
    {
      stage: snapshot.optimizationStage,
      conversionValue,
      finalCents,
      qualityFactor: snapshot.qualityFactor,
      systemScore: snapshot.systemScore,
      valueSource: economics.valueSource,
      currency_code: economics.currencyCode,
    }
  );

  const causalDnaJson = toJsonb(dnaOut);

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
    causalDna: causalDnaJson,
    entropyScore,
    uncertaintyBit,
    conversionNameOverride: conversionName ?? OPSMANTIK_CONVERSION_NAMES[stage],
  });

  if (!result.success) {
    dnaOut = appendBranch(dnaOut, 'marketing_signals_insert_failed', [], {}, {});
    return { success: false, conversionValue: 0, causalDna: toJsonb(dnaOut) };
  }

  if (result.duplicate) {
    dnaOut = appendBranch(
      dnaOut,
      'marketing_signals_duplicate_ignored',
      ['auth', 'idempotency'],
      { callId, sequence: result.adjustmentSequence, hash: result.currentHash },
      {}
    );
    return { success: true, conversionValue, causalDna: toJsonb(dnaOut), duplicate: true };
  }

  if (result.skipped) {
    // Router path always passes clickIds through, but SSOT helper skips when all are null.
    // That can happen when the originating event has no attribution; no error — just no row.
    return { success: true, signalId: null, conversionValue, causalDna: toJsonb(dnaOut) };
  }

  appendCausalDnaLedgerSafe(siteId, 'signal', result.signalId ?? null, causalDnaJson);

  return {
    success: true,
    signalId: result.signalId ?? null,
    conversionValue,
    causalDna: causalDnaJson,
  };
}

function resolveSignalSystemScore(payload: SignalPayload): number {
  if (
    payload.valueCents != null &&
    Number.isFinite(payload.valueCents) &&
    payload.valueCents >= 0 &&
    payload.valueCents <= 100
  ) {
    return Math.round(payload.valueCents);
  }
  return 60;
}
