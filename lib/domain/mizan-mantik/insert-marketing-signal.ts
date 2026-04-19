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
import { toExpectedValueCents } from '@/lib/oci/marketing-signal-hash';
import { upsertMarketingSignal } from './upsert-marketing-signal';

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

  // 'junk' has no economic value. 'won' is owned exclusively by the seal
  // path (offline_conversion_queue). Both are short-circuited here so this
  // router-side insert only emits intent-level rows (contacted / offered).
  if (stage === 'junk' || stage === 'won') {
    return { success: false, conversionValue: 0, causalDna: toJsonb(dna), duplicate: false };
  }

  const snapshot = buildOptimizationSnapshot({
    stage,
    systemScore: resolveSignalSystemScore(payload),
    modelVersion: 'universal-value-v1',
  });

  const finalCents = toExpectedValueCents(snapshot.optimizationValue);
  const conversionValue = snapshot.optimizationValue;

  logShadowDecision(siteId, 'signal', null, 'UNIVERSAL_VALUE', 'Universal stage-base x quality-factor model', {
    stage: snapshot.optimizationStage,
    value_cents: finalCents,
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
    clickIds: {
      gclid: gclid ?? null,
      wbraid: wbraid ?? null,
      gbraid: gbraid ?? null,
    },
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
