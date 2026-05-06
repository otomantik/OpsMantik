import type { PipelineStage, SignalPayload } from '@/lib/oci/signal-types';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';
import { buildOptimizationSnapshot } from '@/lib/oci/optimization-contract';
import { loadMarketingSignalEconomics } from '@/lib/oci/marketing-signal-value-ssot';
import { upsertMarketingSignal } from '@/lib/oci/upsert-marketing-signal';

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
    featureSnapshotExtras: { source_detail: 'oci_signal_insert' },
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
