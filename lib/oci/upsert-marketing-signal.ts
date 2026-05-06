import { adminClient } from '@/lib/supabase/admin';
import type { PipelineStage } from '@/lib/oci/signal-types';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';
import { logError, logInfo, logWarn } from '@/lib/logging/logger';
import { resolveSignalOccurredAtFromIntent } from '@/lib/oci/occurred-at';
import type { OptimizationValueSnapshot } from '@/lib/oci/optimization-contract';
import { computeMarketingSignalCurrentHash } from '@/lib/oci/marketing-signal-hash';
import type { MarketingSignalEconomics } from '@/lib/oci/marketing-signal-value-ssot';
import { appendOciReconciliationEvent } from '@/lib/oci/reconciliation-events';
import { OCI_RECONCILIATION_REASONS } from '@/lib/oci/reconciliation-reasons';

export type UpsertMarketingSignalSource = 'router' | 'seal' | 'panel_stage';

export interface ClickIds {
  gclid: string | null;
  wbraid: string | null;
  gbraid: string | null;
}

function normalizeClickSegment(s: string | null | undefined): string | null {
  const v = typeof s === 'string' ? s.trim() : '';
  return v.length > 0 ? v : null;
}

export interface UpsertMarketingSignalParams {
  source: UpsertMarketingSignalSource;
  siteId: string;
  callId: string | null;
  traceId: string | null;
  stage: Exclude<PipelineStage, 'won'>;
  signalDate: Date;
  snapshot: OptimizationValueSnapshot;
  economics: MarketingSignalEconomics;
  clickIds: ClickIds;
  featureSnapshotExtras?: Record<string, unknown>;
  conversionNameOverride?: string | null;
}

export interface UpsertMarketingSignalResult {
  success: boolean;
  signalId?: string | null;
  duplicate?: boolean;
  skipped?: boolean;
  skippedReason?: 'missing_click_ids';
  expectedValueCents: number;
  currentHash: string;
  adjustmentSequence: number;
}

export async function upsertMarketingSignal(
  params: UpsertMarketingSignalParams
): Promise<UpsertMarketingSignalResult> {
  const {
    source,
    siteId,
    callId,
    traceId,
    stage,
    signalDate,
    snapshot,
    economics,
    clickIds,
    featureSnapshotExtras,
    conversionNameOverride,
  } = params;

  const nClick = {
    gclid: normalizeClickSegment(clickIds.gclid),
    wbraid: normalizeClickSegment(clickIds.wbraid),
    gbraid: normalizeClickSegment(clickIds.gbraid),
  };
  const hasAnyClickId = Boolean(nClick.gclid || nClick.wbraid || nClick.gbraid);
  if (!hasAnyClickId) {
    if (callId) {
      try {
        await appendOciReconciliationEvent({
          siteId,
          callId,
          stage,
          reason: OCI_RECONCILIATION_REASONS.NO_ADS_CLICK_ID,
          expectedConversionName: conversionNameOverride ?? OPSMANTIK_CONVERSION_NAMES[stage],
          result: 'skipped',
          payload: { source },
        });
      } catch {}
    }
    return {
      success: true,
      skipped: true,
      skippedReason: 'missing_click_ids',
      expectedValueCents: 0,
      currentHash: '',
      adjustmentSequence: 0,
    };
  }

  const canonicalName = OPSMANTIK_CONVERSION_NAMES[stage];
  const conversionName = conversionNameOverride ?? canonicalName;
  if (conversionNameOverride != null && conversionNameOverride.trim() !== canonicalName) {
    logWarn('MARKETING_SIGNAL_CONVERSION_NAME_OVERRIDE_DRIFT', {
      site_id: siteId,
      call_id: callId,
      stage,
      canonical_name: canonicalName,
      override: conversionNameOverride,
    });
  }

  let intentCreatedAt: string | null = null;
  if (callId) {
    const { data: callRow } = await adminClient
      .from('calls')
      .select('created_at')
      .eq('id', callId)
      .eq('site_id', siteId)
      .maybeSingle();
    intentCreatedAt = (callRow as { created_at?: string | null } | null)?.created_at ?? null;
  }
  const occurredAtMeta = resolveSignalOccurredAtFromIntent({
    intentCreatedAt,
    fallbackSignalDate: signalDate,
    stage,
  });
  const expectedValueCents = economics.expectedValueCents;

  let sequence = 0;
  let previousHash: string | null = null;
  if (callId) {
    const { data: existing } = await adminClient
      .from('marketing_signals')
      .select('adjustment_sequence, current_hash')
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .eq('google_conversion_name', conversionName)
      .order('adjustment_sequence', { ascending: false })
      .limit(1);
    if (existing && existing.length > 0) {
      sequence = (existing[0].adjustment_sequence ?? 0) + 1;
      previousHash = existing[0].current_hash ?? null;
    }
  }

  const currentHash = computeMarketingSignalCurrentHash({
    callId,
    sequence,
    expectedValueCents,
    previousHash,
  });

  const featureSnapshot: Record<string, unknown> = {
    source,
    has_gclid: Boolean(nClick.gclid),
    has_wbraid: Boolean(nClick.wbraid),
    has_gbraid: Boolean(nClick.gbraid),
    ...(featureSnapshotExtras ?? {}),
  };

  const { data, error } = await adminClient
    .from('marketing_signals')
    .insert({
      site_id: siteId,
      call_id: callId,
      trace_id: traceId,
      signal_type: snapshot.optimizationStage,
      google_conversion_name: conversionName,
      google_conversion_time: signalDate.toISOString(),
      occurred_at: occurredAtMeta.occurredAt,
      source_timestamp: occurredAtMeta.sourceTimestamp,
      time_confidence: occurredAtMeta.timeConfidence,
      occurred_at_source: occurredAtMeta.occurredAtSource,
      expected_value_cents: expectedValueCents,
      currency_code: economics.currencyCode,
      value_source: economics.valueSource,
      value_policy_version: economics.policyVersion,
      value_policy_reason: economics.policyReason,
      value_fallback_used: economics.fallbackUsed,
      conversion_time_source: economics.conversionTimeSource,
      conversion_value: economics.conversionValueMajor,
      optimization_stage: snapshot.optimizationStage,
      optimization_stage_base: snapshot.stageBase,
      optimization_value: economics.conversionValueMajor,
      actual_revenue: snapshot.actualRevenue,
      helper_form_payload: snapshot.helperFormPayload,
      feature_snapshot: featureSnapshot,
      outcome_timestamp: occurredAtMeta.occurredAt,
      model_version: snapshot.modelVersion,
      dispatch_status: 'PENDING',
      causal_dna: {},
      gclid: nClick.gclid,
      wbraid: nClick.wbraid,
      gbraid: nClick.gbraid,
      adjustment_sequence: sequence,
      previous_hash: previousHash,
      current_hash: currentHash,
    })
    .select('id')
    .single();

  if (error) {
    const code = (error as { code?: string })?.code;
    if (code === '23505') {
      logInfo('marketing_signals_duplicate_ignored', { source, call_id: callId, sequence, current_hash: currentHash });
      return { success: true, duplicate: true, expectedValueCents, currentHash, adjustmentSequence: sequence };
    }
    logError('MARKETING_SIGNALS_UPSERT_FAILED', { source, error: error.message, code, call_id: callId });
    return { success: false, expectedValueCents, currentHash, adjustmentSequence: sequence };
  }

  const signalId = (data as { id: string } | null)?.id ?? null;
  return { success: true, signalId, expectedValueCents, currentHash, adjustmentSequence: sequence };
}
