import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';
import { verifyProbeSignature } from '@/lib/probe/verify-signature';
import { normalizeCurrencyOrNeutral } from '@/lib/i18n/site-locale';
import { resolveSealOccurredAt } from '@/lib/oci/occurred-at';
import { notifyOutboxPending } from '@/lib/oci/notify-outbox';
import { triggerOutboxNowBestEffort } from '@/lib/oci/outbox/trigger-now';
import { enqueuePanelStageOciOutbox, type PanelReturnedCall } from '@/lib/oci/enqueue-panel-stage-outbox';
import {
  panelOciProducerHttpStatus,
  panelOciResponseFields,
  panelOciRouteSuccess,
} from '@/lib/oci/panel-oci-response';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { isApplyCallActionV2SignatureMissing } from '@/lib/oci/apply-call-action-v2-compat';

export type HandleSealProbePostInput = {
  callId: string;
  deviceId: string;
  body: Record<string, unknown>;
  requestId?: string;
  route: string;
};

export async function handleSealProbePost(input: HandleSealProbePostInput): Promise<NextResponse> {
  const { callId, deviceId, body, requestId, route } = input;

  const { data: call } = await adminClient
    .from('calls')
    .select('id, site_id, version, created_at')
    .eq('id', callId)
    .maybeSingle();
  if (!call) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }
  const { data: device } = await adminClient
    .from('probe_devices')
    .select('id, public_key_pem')
    .eq('site_id', call.site_id)
    .eq('device_id', deviceId)
    .maybeSingle();
  if (!device?.public_key_pem) {
    return NextResponse.json({ error: 'Device not registered' }, { status: 401 });
  }

  const confirmedAtIso = new Date().toISOString();
  const timestampMs =
    typeof body.timestamp === 'number' && Number.isFinite(body.timestamp)
      ? body.timestamp
      : typeof body.timestamp === 'string' && Number.isFinite(Number(body.timestamp))
        ? Number(body.timestamp)
        : null;
  const occurredAtMeta = resolveSealOccurredAt({
    intentCreatedAt: (call as { created_at?: string | null } | null)?.created_at ?? null,
    saleOccurredAt: timestampMs != null ? new Date(timestampMs).toISOString() : null,
    fallbackConfirmedAt: confirmedAtIso,
  });

  const probePayload = {
    callId,
    saleAmount: body.saleAmount,
    currency: body.currency ?? 'TRY',
    merchantNotes: body.merchantNotes,
    timestamp: body.timestamp,
  };
  const sigResult = verifyProbeSignature(
    device.public_key_pem as string,
    probePayload,
    (body.signature as string).trim()
  );
  if (!sigResult.ok) {
    logWarn('PROBE_SEAL_SIGNATURE_REJECTED', { route, call_id: callId, error: sigResult.error });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }
  const saleAmountProbe = body.saleAmount != null ? Number(body.saleAmount) : null;
  const currencyProbe = normalizeCurrencyOrNeutral(typeof body.currency === 'string' ? body.currency : null);
  const merchantNotes = typeof body.merchantNotes === 'string' ? body.merchantNotes.trim().slice(0, 500) : '';
  if (saleAmountProbe != null && (Number.isNaN(saleAmountProbe) || saleAmountProbe < 0)) {
    return NextResponse.json({ error: 'saleAmount must be non-negative' }, { status: 400 });
  }

  const rpcPayload = {
    p_call_id: callId,
    p_site_id: call.site_id,
    p_stage: 'won',
    p_actor_id: deviceId,
    p_lead_score: 100,
    p_sale_metadata: {
      amount: saleAmountProbe,
      currency: currencyProbe,
      occurred_at: occurredAtMeta.occurredAt,
      notes: merchantNotes,
    },
    p_version: call.version,
    p_metadata: { route, request_id: requestId, source: 'probe_v2' },
  };
  let { data: updatedCall, error: updateError } = await adminClient.rpc('apply_call_action_v2', rpcPayload);
  if (isApplyCallActionV2SignatureMissing(updateError as { code?: string; message?: string } | null)) {
    const retry = await adminClient.rpc('apply_call_action_v2', {
      p_call_id: callId,
      p_site_id: call.site_id,
      p_stage: 'won',
      p_actor_id: deviceId,
      p_lead_score: 100,
      p_version: call.version,
      p_metadata: {
        route,
        request_id: requestId,
        source: 'probe_v2',
        compat_path: 'legacy_v2_signature',
        sale_metadata: {
          amount: saleAmountProbe,
          currency: currencyProbe,
          occurred_at: occurredAtMeta.occurredAt,
          notes: merchantNotes,
        },
      },
    });
    updatedCall = retry.data;
    updateError = retry.error;
  }

  const firstErrorCode = (updateError as { code?: string } | null)?.code;
  if (firstErrorCode === '40900') {
    const { data: latestCall } = await adminClient
      .from('calls')
      .select('version')
      .eq('id', callId)
      .eq('site_id', call.site_id)
      .maybeSingle();
    const latestVersion =
      typeof (latestCall as { version?: unknown } | null)?.version === 'number' &&
      Number.isFinite((latestCall as { version: number }).version)
        ? Math.round((latestCall as { version: number }).version)
        : null;
    if (latestVersion !== null) {
      const retryConflict = await adminClient.rpc('apply_call_action_v2', {
        ...rpcPayload,
        p_version: latestVersion,
      });
      updatedCall = retryConflict.data;
      updateError = retryConflict.error;
    }
  }

  if (updateError) {
    logWarn('PROBE_SEAL_V2_FAILED', { callId, error: updateError.message });
    return NextResponse.json({ error: updateError.message }, { status: 409 });
  }

  const callObj = updatedCall as PanelReturnedCall;
  const ociProbe = await enqueuePanelStageOciOutbox(callObj, { requestId });
  if (!ociProbe.ok) {
    incrementRefactorMetric('panel_stage_oci_producer_incomplete_total');
    incrementRefactorMetric('panel_oci_partial_failure_total');
  } else if (!ociProbe.outboxInserted && ociProbe.reconciliationPersisted) {
    incrementRefactorMetric('panel_oci_reconciliation_reason_total');
  }

  if (ociProbe.outboxInserted) {
    void notifyOutboxPending({ callId, siteId: call.site_id, source: 'seal_probe_v2' });
    void triggerOutboxNowBestEffort({ callId, siteId: call.site_id, source: 'seal_probe_v2' });
  }

  const probeHttp = panelOciProducerHttpStatus(ociProbe);
  if (probeHttp >= 400) {
    incrementRefactorMetric('panel_oci_fail_closed_total');
  }
  return NextResponse.json(
    {
      success: panelOciRouteSuccess(ociProbe),
      approval_required: false,
      call: callObj,
      queued: ociProbe.outboxInserted,
      oci_outbox_inserted: ociProbe.outboxInserted,
      oci_reconciliation_persisted:
        ociProbe.reconciliationPersisted === undefined ? null : ociProbe.reconciliationPersisted,
      oci_reconciliation_reason: ociProbe.oci_reconciliation_reason,
      oci_enqueue_ok: ociProbe.ok,
      request_id: requestId,
      ...panelOciResponseFields(ociProbe),
    },
    { status: probeHttp }
  );
}
