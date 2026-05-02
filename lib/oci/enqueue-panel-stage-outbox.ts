import { adminClient } from '@/lib/supabase/admin';
import { logInfo, logWarn } from '@/lib/logging/logger';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import {
  isLikelyInternalTestClickId,
} from '@/lib/oci/oci-click-eligibility';
import { hasAnyAdsClickId } from '@/lib/oci/session-click-id';
import { appendOciReconciliationEvent } from '@/lib/oci/reconciliation-events';
import { OCI_RECONCILIATION_REASONS } from '@/lib/oci/reconciliation-reasons';

async function appendReconciliationBestEffort(params: Parameters<typeof appendOciReconciliationEvent>[0]): Promise<void> {
  try {
    await appendOciReconciliationEvent(params);
  } catch (error) {
    incrementRefactorMetric('panel_stage_reconciliation_append_failed_total');
    logWarn('panel_stage_reconciliation_append_failed', {
      call_id: params.callId,
      site_id: params.siteId,
      stage: params.stage,
      reason: params.reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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

/**
 * After panel stage RPC succeeds, inserts a PENDING outbox row so the OCI worker
 * can emit marketing_signals / offline_conversion_queue. Without this row,
 * notifyOutboxPending alone has nothing to claim.
 */
export async function enqueuePanelStageOciOutbox(call: PanelReturnedCall): Promise<{ ok: boolean }> {
  const stage = resolveOciStageFromCallStatus(call.status);
  if (!stage) {
    await appendReconciliationBestEffort({
      siteId: call.site_id,
      callId: call.id,
      stage: 'none',
      reason: OCI_RECONCILIATION_REASONS.NOT_EXPORTABLE_STAGE,
      matchedSessionId: call.matched_session_id ?? null,
      primaryClickIdPresent: false,
      payload: { call_status: call.status ?? null },
    });
    return { ok: true };
  }

  const sessionId = call.matched_session_id;
  if (!sessionId) {
    incrementRefactorMetric('panel_stage_outbox_skip_no_matched_session_total');
    logInfo('panel_stage_outbox_skip', {
      reason: 'no_matched_session',
      call_id: call.id,
      site_id: call.site_id,
      stage,
    });
    await appendReconciliationBestEffort({
      siteId: call.site_id,
      callId: call.id,
      stage,
      reason: OCI_RECONCILIATION_REASONS.NO_MATCHED_SESSION,
      matchedSessionId: null,
      primaryClickIdPresent: false,
    });
    return { ok: true };
  }

  const { data: session, error: sessionErr } = await adminClient
    .from('sessions')
    .select('gclid, wbraid, gbraid')
    .eq('id', sessionId)
    .eq('site_id', call.site_id)
    .maybeSingle();

  if (sessionErr || !session) {
    incrementRefactorMetric('panel_stage_outbox_skip_no_matched_session_total');
    logInfo('panel_stage_outbox_skip', {
      reason: 'session_not_found',
      call_id: call.id,
      site_id: call.site_id,
      session_id: sessionId,
      err: sessionErr?.message,
    });
    await appendReconciliationBestEffort({
      siteId: call.site_id,
      callId: call.id,
      stage,
      reason: OCI_RECONCILIATION_REASONS.SESSION_NOT_FOUND,
      matchedSessionId: sessionId,
      primaryClickIdPresent: false,
      payload: { session_error: sessionErr?.message ?? null },
    });
    return { ok: true };
  }

  const s = session as { gclid?: string | null; wbraid?: string | null; gbraid?: string | null };
  if (isLikelyInternalTestClickId(s)) {
    incrementRefactorMetric('panel_stage_outbox_skip_test_click_id_total');
    logInfo('panel_stage_outbox_skip', { reason: 'test_click_id', call_id: call.id, site_id: call.site_id });
    await appendReconciliationBestEffort({
      siteId: call.site_id,
      callId: call.id,
      stage,
      reason: OCI_RECONCILIATION_REASONS.TEST_CLICK_ID,
      matchedSessionId: sessionId,
      primaryClickIdPresent: hasAnyAdsClickId(s),
    });
    return { ok: true };
  }

  if (!hasAnyAdsClickId(s)) {
    incrementRefactorMetric('panel_stage_outbox_skip_no_ads_click_id_total');
    logInfo('panel_stage_outbox_skip', {
      reason: 'no_ads_click_id',
      call_id: call.id,
      site_id: call.site_id,
      session_id: sessionId,
    });
    await appendReconciliationBestEffort({
      siteId: call.site_id,
      callId: call.id,
      stage,
      reason: OCI_RECONCILIATION_REASONS.NO_ADS_CLICK_ID,
      matchedSessionId: sessionId,
      primaryClickIdPresent: false,
    });
    return { ok: true };
  }

  const nowIso = new Date().toISOString();
  const wonLike = stage === 'won';
  const confirmedAt =
    (wonLike ? call.confirmed_at : null) ??
    (typeof call.updated_at === 'string' ? call.updated_at : null) ??
    nowIso;
  const currency = (call.currency ?? 'TRY').trim() || 'TRY';

  const payload = {
    call_id: call.id,
    site_id: call.site_id,
    lead_score: call.lead_score ?? null,
    stage,
    confirmed_at: confirmedAt,
    created_at: call.created_at ?? confirmedAt,
    sale_occurred_at: call.sale_occurred_at ?? null,
    sale_source_timestamp: call.sale_source_timestamp ?? null,
    sale_time_confidence: call.sale_time_confidence ?? null,
    sale_occurred_at_source: call.sale_occurred_at_source ?? null,
    sale_entry_reason: call.sale_entry_reason ?? null,
    sale_amount: call.sale_amount ?? null,
    currency,
  };

  const { error } = await adminClient.from('outbox_events').insert({
    event_type: 'IntentSealed',
    call_id: call.id,
    site_id: call.site_id,
    status: 'PENDING',
    payload,
  });

  if (error) {
    incrementRefactorMetric('panel_stage_outbox_insert_failed_total');
    logWarn('panel_stage_outbox_insert_failed', {
      call_id: call.id,
      site_id: call.site_id,
      stage,
      message: error.message,
    });
    try {
      await appendOciReconciliationEvent({
        siteId: call.site_id,
        callId: call.id,
        stage,
        reason: OCI_RECONCILIATION_REASONS.OUTBOX_INSERT_FAILED,
        matchedSessionId: sessionId,
        primaryClickIdPresent: true,
        payload: { insert_error: error.message },
      });
    } catch (reconciliationError) {
      logWarn('panel_stage_outbox_insert_failed_reconciliation_best_effort_failed', {
        call_id: call.id,
        site_id: call.site_id,
        stage,
        error: reconciliationError instanceof Error ? reconciliationError.message : String(reconciliationError),
      });
    }
    return { ok: false };
  }

  return { ok: true };
}
