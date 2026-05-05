import { adminClient } from '@/lib/supabase/admin';
import { logInfo, logWarn } from '@/lib/logging/logger';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { isLikelyInternalTestClickId } from '@/lib/oci/oci-click-eligibility';
import { hasAnyAdsClickId } from '@/lib/oci/session-click-id';
import { appendOciReconciliationEvent } from '@/lib/oci/reconciliation-events';
import { OCI_RECONCILIATION_REASONS } from '@/lib/oci/reconciliation-reasons';
import type { OciReconciliationReason } from '@/lib/oci/reconciliation-reasons';
import { resolveOciClickAttribution, type PrimarySource } from '@/lib/oci/oci-click-attribution';
import { overlayPanelReturnedCallMergeContextFromDb } from '@/lib/oci/panel-call-merge-context';

async function appendReconciliationBestEffort(
  params: Parameters<typeof appendOciReconciliationEvent>[0]
): Promise<{ persisted: boolean }> {
  try {
    await appendOciReconciliationEvent(params);
    return { persisted: true };
  } catch (error) {
    incrementRefactorMetric('panel_stage_reconciliation_persist_failed_total');
    logWarn('panel_stage_reconciliation_persist_failed', {
      call_id: params.callId,
      site_id: params.siteId,
      stage: params.stage,
      reason: params.reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return { persisted: false };
  }
}

/**
 * When true, persisted `intent` + valid non-test Ads click → enqueue payload stage `contacted`
 * (panel-only precursor; sync/ingest path is out of scope).
 */
export function isIntentPanelPrecursorContactedEnabled(): boolean {
  const v = (process.env.OCI_INTENT_PANEL_PRECURSOR_CONTACTED_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Tek SSOT yüzü: panel/stage/seal başarından sonra IntentSealed outbox.
 * Tüm prod mutasyon yüzleri burayı çağırır — kanıt: `tests/architecture/oci-outbox-producer-invariant.test.ts`.
 *
 * Maps persisted call.status (panel / RPC) to the explicit OCI pipeline stage
 * stored on outbox payload. Must stay aligned with process-outbox + SingleConversionGear.
 */
export function resolveOciStageFromCallStatus(
  status: string | null | undefined
): 'contacted' | 'offered' | 'won' | 'junk' | null {
  const s = (status ?? '').trim().toLowerCase();
  if (s === 'junk') return 'junk';
  if (s === 'contacted') return 'contacted';
  if (s === 'offered') return 'offered';
  if (s === 'won' || s === 'confirmed' || s === 'qualified' || s === 'real') return 'won';
  return null;
}

export type PanelReturnedCall = {
  id: string;
  site_id: string;
  matched_session_id?: string | null;
  merged_into_call_id?: string | null;
  /** When present (RPC), compared to DB `calls.version` during merge overlay. */
  version?: number | null;
  lead_score?: number | null;
  status?: string | null;
  confirmed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  sale_amount?: number | null;
  currency?: string | null;
  sale_occurred_at?: string | null;
  sale_source_timestamp?: string | null;
  sale_time_confidence?: string | null;
  sale_occurred_at_source?: string | null;
  sale_entry_reason?: string | null;
};

export type PanelStageOciSkipMetric =
  | 'merged'
  | 'no_exportable'
  | 'test_click'
  | 'no_ads'
  | 'no_matched_session';

export type PanelStageOciEnqueueOptions = {
  /** Correlates Vercel logs with `outbox_events.payload.request_id` when set. */
  requestId?: string | null;
};

export type PanelStageOciEnqueueResult = {
  /**
   * True when a new `outbox_events` row was inserted, or when reconcile/skip path
   * persisted (or idempotent-duplicated) an `oci_reconciliation_events` row.
   */
  ok: boolean;
  outboxInserted: boolean;
  /** Set when the producer chose reconcile/skip (audit path). */
  reconciliationPersisted?: boolean;
  /**
   * Canonical reconciliation reason when the producer did not insert outbox (skip path),
   * or `OUTBOX_INSERT_FAILED` after a failed insert attempt; `null` on successful outbox insert.
   */
  oci_reconciliation_reason: string | null;
};

/** INV: no silent success — at least one durable artifact. */
export function panelStageOciProducerOk(r: Pick<PanelStageOciEnqueueResult, 'outboxInserted' | 'reconciliationPersisted'>): boolean {
  return r.outboxInserted || r.reconciliationPersisted === true;
}

export type PanelStageOciEnqueuePlan =
  | { outcome: 'insert'; stage: 'contacted' | 'offered' | 'won' | 'junk' }
  | {
      outcome: 'reconcile';
      reason: OciReconciliationReason;
      stageForAudit: string;
      primaryClickIdPresent: boolean;
      matchedSessionId: string | null;
      payload?: Record<string, unknown>;
      metric: PanelStageOciSkipMetric;
    };

/**
 * Pure decision: given RPC-returned call shape + resolved primary source (same as worker),
 * decide insert vs reconciliation. Exported for unit tests.
 */
export function planPanelStageOciEnqueue(params: {
  call: PanelReturnedCall;
  primary: PrimarySource | null;
  intentPrecursorEnabled: boolean;
}): PanelStageOciEnqueuePlan {
  const { call, primary, intentPrecursorEnabled } = params;
  const matchedSessionId = call.matched_session_id?.trim() ? call.matched_session_id!.trim() : null;
  const hasSession = Boolean(matchedSessionId);

  if (call.merged_into_call_id != null && String(call.merged_into_call_id).trim().length > 0) {
    return {
      outcome: 'reconcile',
      reason: OCI_RECONCILIATION_REASONS.MERGED_CALL,
      stageForAudit: 'none',
      primaryClickIdPresent: Boolean(primary && hasAnyAdsClickId(primary)),
      matchedSessionId,
      payload: { merged_into_call_id: call.merged_into_call_id },
      metric: 'merged',
    };
  }

  const statusLower = (call.status ?? '').trim().toLowerCase();
  const baseStage = resolveOciStageFromCallStatus(call.status);
  let exportableStage = baseStage;

  const rawClickPresent = Boolean(primary && hasAnyAdsClickId(primary));
  const testClick = Boolean(primary && isLikelyInternalTestClickId(primary));

  if (
    baseStage === null &&
    statusLower === 'intent' &&
    intentPrecursorEnabled &&
    rawClickPresent &&
    !testClick
  ) {
    exportableStage = 'contacted';
  }

  if (exportableStage === null) {
    return {
      outcome: 'reconcile',
      reason: OCI_RECONCILIATION_REASONS.NO_EXPORTABLE_OCI_STAGE,
      stageForAudit: 'none',
      primaryClickIdPresent: rawClickPresent,
      matchedSessionId,
      payload: { call_status: call.status ?? null },
      metric: 'no_exportable',
    };
  }

  if (testClick) {
    return {
      outcome: 'reconcile',
      reason: OCI_RECONCILIATION_REASONS.TEST_CLICK_ID,
      stageForAudit: exportableStage,
      primaryClickIdPresent: rawClickPresent,
      matchedSessionId,
      metric: 'test_click',
    };
  }

  if (!rawClickPresent) {
    const reason = !hasSession ? OCI_RECONCILIATION_REASONS.NO_MATCHED_SESSION : OCI_RECONCILIATION_REASONS.NO_ADS_CLICK_ID;
    return {
      outcome: 'reconcile',
      reason,
      stageForAudit: exportableStage,
      primaryClickIdPresent: false,
      matchedSessionId,
      metric: !hasSession ? 'no_matched_session' : 'no_ads',
    };
  }

  return { outcome: 'insert', stage: exportableStage };
}

function isTransientOutboxInsertError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? '';
  return ['40001', '40P01', '57014', '55P03', '08006'].includes(code);
}

/** Unique violation on outbox pre-dedupe index — row already queued for this call+stage. */
function isOutboxPrededupeConflict(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? '';
  return code === '23505';
}

function bumpSkipMetric(metric: PanelStageOciSkipMetric): void {
  if (metric === 'merged') incrementRefactorMetric('panel_stage_outbox_skip_merged_call_total');
  else if (metric === 'no_exportable') incrementRefactorMetric('panel_stage_outbox_skip_no_exportable_oci_stage_total');
  else if (metric === 'test_click') incrementRefactorMetric('panel_stage_outbox_skip_test_click_id_total');
  else if (metric === 'no_ads') incrementRefactorMetric('panel_stage_outbox_skip_no_ads_click_id_total');
  else if (metric === 'no_matched_session') incrementRefactorMetric('panel_stage_outbox_skip_no_matched_session_total');
}

/**
 * After panel stage RPC succeeds, inserts a PENDING outbox row so the OCI worker
 * can emit marketing_signals / offline_conversion_queue. Without this row,
 * notifyOutboxPending alone has nothing to claim.
 *
 * Click eligibility uses {@link resolveOciClickAttribution} (aligned with process-outbox `getPrimarySource`).
 */
export async function enqueuePanelStageOciOutbox(
  call: PanelReturnedCall,
  options?: PanelStageOciEnqueueOptions
): Promise<PanelStageOciEnqueueResult> {
  const effectiveCall = await overlayPanelReturnedCallMergeContextFromDb(call);
  const primary = await resolveOciClickAttribution(effectiveCall.site_id, { callId: effectiveCall.id });
  const plan = planPanelStageOciEnqueue({
    call: effectiveCall,
    primary,
    intentPrecursorEnabled: isIntentPanelPrecursorContactedEnabled(),
  });

  if (
    plan.outcome === 'insert' &&
    (process.env.OCI_PRODUCER_PRIMARY_RECHECK ?? '').trim().toLowerCase() === '1'
  ) {
    const primary2 = await resolveOciClickAttribution(effectiveCall.site_id, { callId: effectiveCall.id });
    if ((primary ? hasAnyAdsClickId(primary) : false) !== (primary2 ? hasAnyAdsClickId(primary2) : false)) {
      incrementRefactorMetric('oci_producer_primary_window_drift_total');
      logWarn('oci_producer_primary_window_drift', {
        call_id: effectiveCall.id,
        site_id: effectiveCall.site_id,
      });
    }
  }

  if (plan.outcome === 'reconcile') {
    bumpSkipMetric(plan.metric);
    logInfo('panel_stage_outbox_skip', {
      reason: plan.reason,
      call_id: effectiveCall.id,
      site_id: effectiveCall.site_id,
      stage: plan.stageForAudit,
    });
    const { persisted } = await appendReconciliationBestEffort({
      siteId: effectiveCall.site_id,
      callId: effectiveCall.id,
      stage: plan.stageForAudit,
      reason: plan.reason,
      matchedSessionId: plan.matchedSessionId,
      primaryClickIdPresent: plan.primaryClickIdPresent,
      payload: plan.payload,
    });
    return {
      ok: persisted,
      outboxInserted: false,
      reconciliationPersisted: persisted,
      oci_reconciliation_reason: plan.reason,
    };
  }

  const stage = plan.stage;
  const nowIso = new Date().toISOString();
  const wonLike = stage === 'won';
  const confirmedAt =
    (wonLike ? effectiveCall.confirmed_at : null) ??
    (typeof effectiveCall.updated_at === 'string' ? effectiveCall.updated_at : null) ??
    nowIso;
  const currency = (effectiveCall.currency ?? 'TRY').trim() || 'TRY';

  const requestId = options?.requestId?.trim();
  const payload = {
    call_id: effectiveCall.id,
    site_id: effectiveCall.site_id,
    lead_score: effectiveCall.lead_score ?? null,
    stage,
    confirmed_at: confirmedAt,
    created_at: effectiveCall.created_at ?? confirmedAt,
    sale_occurred_at: effectiveCall.sale_occurred_at ?? null,
    sale_source_timestamp: effectiveCall.sale_source_timestamp ?? null,
    sale_time_confidence: effectiveCall.sale_time_confidence ?? null,
    sale_occurred_at_source: effectiveCall.sale_occurred_at_source ?? null,
    sale_entry_reason: effectiveCall.sale_entry_reason ?? null,
    sale_amount: effectiveCall.sale_amount ?? null,
    currency,
    ...(requestId ? { request_id: requestId } : {}),
  };

  let insertError: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await adminClient.from('outbox_events').insert({
      event_type: 'IntentSealed',
      call_id: effectiveCall.id,
      site_id: effectiveCall.site_id,
      status: 'PENDING',
      payload,
    });
    if (!error) {
      insertError = null;
      break;
    }
    insertError = error;
    if (isOutboxPrededupeConflict(error)) {
      incrementRefactorMetric('panel_stage_outbox_insert_prededupe_idempotent_total');
      logInfo('panel_stage_outbox_insert_prededupe_hit', {
        call_id: effectiveCall.id,
        site_id: effectiveCall.site_id,
        stage,
      });
      return {
        ok: true,
        outboxInserted: true,
        oci_reconciliation_reason: null,
      };
    }
    if (attempt === 0 && isTransientOutboxInsertError(error)) {
      logWarn('panel_stage_outbox_insert_retry', {
        call_id: effectiveCall.id,
        site_id: effectiveCall.site_id,
        stage,
        code: (error as { code?: string }).code,
        message: error.message,
      });
      continue;
    }
    break;
  }

  if (insertError) {
    incrementRefactorMetric('panel_stage_outbox_insert_failed_total');
    logWarn('panel_stage_outbox_insert_failed', {
      call_id: effectiveCall.id,
      site_id: effectiveCall.site_id,
      stage,
      message: insertError.message,
    });
    let reconciliationPersisted = false;
    try {
      await appendOciReconciliationEvent({
        siteId: effectiveCall.site_id,
        callId: effectiveCall.id,
        stage,
        reason: OCI_RECONCILIATION_REASONS.OUTBOX_INSERT_FAILED,
        matchedSessionId: effectiveCall.matched_session_id ?? null,
        primaryClickIdPresent: true,
        payload: { insert_error: insertError.message },
      });
      reconciliationPersisted = true;
    } catch (reconciliationError) {
      logWarn('panel_stage_outbox_insert_failed_reconciliation_best_effort_failed', {
        call_id: effectiveCall.id,
        site_id: effectiveCall.site_id,
        stage,
        error: reconciliationError instanceof Error ? reconciliationError.message : String(reconciliationError),
      });
    }
    const ok = panelStageOciProducerOk({ outboxInserted: false, reconciliationPersisted });
    return {
      ok,
      outboxInserted: false,
      reconciliationPersisted,
      oci_reconciliation_reason: OCI_RECONCILIATION_REASONS.OUTBOX_INSERT_FAILED,
    };
  }

  return {
    ok: true,
    outboxInserted: true,
    oci_reconciliation_reason: null,
  };
}
