/**
 * upsertMarketingSignal — SSOT for writing rows to `marketing_signals`.
 *
 * Before this helper, three parallel INSERT paths existed:
 *   1. The Mizan-Mantik stage router (via insert-marketing-signal.ts, router source).
 *   2. The seal route (app/api/calls/[id]/seal/route.ts, manual stage action source).
 *   3. The panel stage route (app/api/intents/[id]/stage/route.ts, panel source).
 *
 * Each had slightly different hash logic, feature_snapshot shapes, and causalDna
 * structures, making `marketing_signals` writes hard to audit and drift-prone.
 *
 * This helper collapses all three into one code path. Every call must declare a
 * `source` so that the row's `feature_snapshot.source` and `causal_dna.source`
 * carry the provenance needed for forensic replay.
 *
 * Economics (**value_cents / currency / value_source**) are **never computed here**
 * — callers MUST pass **`economics`** from `loadMarketingSignalEconomics`.
 *
 * The helper is idempotent at the DB level via the
 * (site_id, call_id, google_conversion_name, adjustment_sequence) unique index:
 * a 23505 duplicate violation collapses to `{ success: true, duplicate: true }`.
 */

import { adminClient } from '@/lib/supabase/admin';
import type { PipelineStage } from './types';
import { OPSMANTIK_CONVERSION_NAMES } from './conversion-names';
import { logError, logInfo, logWarn } from '@/lib/logging/logger';
import { resolveSignalOccurredAt } from '@/lib/oci/occurred-at';
import type { OptimizationValueSnapshot } from '@/lib/oci/optimization-contract';
import { computeMarketingSignalCurrentHash } from '@/lib/oci/marketing-signal-hash';
import type { MarketingSignalEconomics } from '@/lib/oci/marketing-signal-value-ssot';
import { appendOciReconciliationEvent } from '@/lib/oci/reconciliation-events';
import { OCI_RECONCILIATION_REASONS } from '@/lib/oci/reconciliation-reasons';

export type UpsertMarketingSignalSource =
  | 'router'
  | 'seal'
  | 'panel_stage';

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
  /** Provenance tag — must uniquely identify the caller path for audit/replay. */
  source: UpsertMarketingSignalSource;
  /** Tenant scope. */
  siteId: string;
  /** Lead / call being signalled. `null` only for truly siteless diagnostic flows. */
  callId: string | null;
  /** Cross-system trace (OpenTelemetry / request_id). */
  traceId: string | null;
  /**
   * Canonical pipeline stage. `won` is excluded: satış dönüşümü yalnızca
   * `enqueueSealConversion` → `offline_conversion_queue` (OpsMantik_Won).
   * `contacted`, `offered`, `junk` bu helper üzerinden `marketing_signals`’a gider.
   */
  stage: Exclude<PipelineStage, 'won'>;
  /** Signal timestamp (business time, typically `now()` at stage transition). */
  signalDate: Date;
  /** Pre-computed optimization snapshot (stage-base × quality factor × system score). */
  snapshot: OptimizationValueSnapshot;
  /** SSOT economics from loadMarketingSignalEconomics / resolveMarketingSignalEconomics. */
  economics: MarketingSignalEconomics;
  /** Click IDs harvested from the originating call (at least one is needed for OCI). */
  clickIds: ClickIds;
  /** feature_snapshot.* fields (merged with `{ source }` by this helper). */
  featureSnapshotExtras?: Record<string, unknown>;
  /** causal_dna payload (the helper stamps `source` on top of this). */
  causalDna: Record<string, unknown>;
  /** Optional entropy/uncertainty (router path supplies them; seal/panel leave them null). */
  entropyScore?: number | null;
  uncertaintyBit?: boolean | null;
  /** Optional conversionName override; defaults to OPSMANTIK_CONVERSION_NAMES[stage]. */
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

/**
 * Upsert a marketing_signals row using the canonical hash chain.
 *
 * Callers must not pass `won` — seal enqueue owns Won (offline_conversion_queue).
 */
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
    causalDna,
    entropyScore,
    uncertaintyBit,
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
      } catch {
        // Best-effort audit; SSOT skip path still succeeds.
      }
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

  const occurredAtMeta = resolveSignalOccurredAt(signalDate, stage);
  const expectedValueCents = economics.expectedValueCents;
  const signalIso = signalDate.toISOString();

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

  const causalDnaPayload: Record<string, unknown> = {
    source,
    ...causalDna,
  };

  const isJunk = stage === 'junk';
  const stageBasePersist = isJunk ? 0.1 : snapshot.stageBase;
  const qualityFactorPersist = isJunk ? 1 : snapshot.qualityFactor;

  const insertPayload: Record<string, unknown> = {
    site_id: siteId,
    call_id: callId,
    trace_id: traceId,
    signal_type: snapshot.optimizationStage,
    google_conversion_name: conversionName,
    google_conversion_time: signalIso,
    occurred_at: occurredAtMeta.occurredAt,
    source_timestamp: occurredAtMeta.sourceTimestamp,
    time_confidence: occurredAtMeta.timeConfidence,
    occurred_at_source: occurredAtMeta.occurredAtSource,
    expected_value_cents: expectedValueCents,
    currency_code: economics.currencyCode,
    value_source: economics.valueSource,
    conversion_time_source: economics.conversionTimeSource,
    conversion_value: economics.conversionValueMajor,
    optimization_stage: snapshot.optimizationStage,
    optimization_stage_base: stageBasePersist,
    system_score: snapshot.systemScore,
    quality_factor: qualityFactorPersist,
    optimization_value: economics.conversionValueMajor,
    actual_revenue: snapshot.actualRevenue,
    helper_form_payload: snapshot.helperFormPayload,
    feature_snapshot: featureSnapshot,
    outcome_timestamp: occurredAtMeta.occurredAt,
    model_version: snapshot.modelVersion,
    dispatch_status: 'PENDING',
    causal_dna: causalDnaPayload,
    entropy_score: entropyScore ?? null,
    uncertainty_bit: uncertaintyBit ?? null,
    gclid: nClick.gclid,
    wbraid: nClick.wbraid,
    gbraid: nClick.gbraid,
    adjustment_sequence: sequence,
    previous_hash: previousHash,
    current_hash: currentHash,
  };

  const { data, error } = await adminClient
    .from('marketing_signals')
    .insert(insertPayload)
    .select('id')
    .single();

  if (error) {
    const code = (error as { code?: string })?.code;
    if (code === '23505') {
      logInfo('marketing_signals_duplicate_ignored', {
        source,
        call_id: callId,
        sequence,
        current_hash: currentHash,
      });
      return {
        success: true,
        duplicate: true,
        expectedValueCents,
        currentHash,
        adjustmentSequence: sequence,
      };
    }
    logError('MARKETING_SIGNALS_UPSERT_FAILED', {
      source,
      error: error.message,
      code,
      call_id: callId,
    });
    return {
      success: false,
      expectedValueCents,
      currentHash,
      adjustmentSequence: sequence,
    };
  }

  const signalId = (data as { id: string } | null)?.id ?? null;
  return {
    success: true,
    signalId,
    expectedValueCents,
    currentHash,
    adjustmentSequence: sequence,
  };
}
