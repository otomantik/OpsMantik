import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { logError, logWarn } from '@/lib/logging/logger';
import { hasCapability } from '@/lib/auth/rbac';
import { invalidatePendingOciArtifactsForCall } from '@/lib/oci/invalidate-pending-artifacts';
import {
  buildOptimizationSnapshot,
  resolveOptimizationStage,
  sanitizeHelperFormPayload,
} from '@/lib/oci/optimization-contract';
import { enqueueSealConversion } from '@/lib/oci/enqueue-seal-conversion';
import { upsertMarketingSignal } from '@/lib/domain/mizan-mantik/upsert-marketing-signal';
import { buildPhoneIdentity } from '@/lib/dic/phone-hash';
import { normalizeCurrencyOrNeutral } from '@/lib/i18n/site-locale';
import { notifyOutboxPending } from '@/lib/oci/notify-outbox';

export const dynamic = 'force-dynamic';

const route = '/api/intents/[id]/stage';

type RpcCallRecord = { id: string; status?: string | null };

function resolvePersistedCall(rpcResult: unknown): RpcCallRecord | null {
  const callObj = Array.isArray(rpcResult) && rpcResult.length === 1 ? rpcResult[0] : rpcResult;
  if (!callObj || typeof callObj !== 'object' || !('id' in callObj)) {
    return null;
  }
  return callObj as RpcCallRecord;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = req.headers.get('x-request-id') ?? undefined;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { phone, score, action_type } = body;
    const { id: callId } = await params;
    const actionType = typeof action_type === 'string' ? action_type.trim().toLowerCase() : null;
    const roundedScore = typeof score === 'number' ? Math.max(0, Math.min(100, Math.round(score))) : null;
    const helperFormPayload = sanitizeHelperFormPayload(
      body.helper_form_payload && typeof body.helper_form_payload === 'object'
        ? body.helper_form_payload
        : null
    );

    if (roundedScore === null && !actionType) {
      return NextResponse.json({ error: 'score or action_type is required' }, { status: 400 });
    }

    const { data: call, error: callError } = await adminClient
      .from('calls')
      .select('id, site_id, matched_session_id, currency, gclid, wbraid, gbraid')
      .eq('id', callId)
      .single();

    if (callError || !call) {
      return NextResponse.json({ error: 'Call not found' }, { status: 404 });
    }

    const siteId = call.site_id;
    const access = await validateSiteAccess(siteId, user.id, supabase);
    if (!access.allowed || !access.role || !hasCapability(access.role, 'queue:operate')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const isJunkAction =
      actionType === 'junk'
      || roundedScore === 0;

    if (isJunkAction) {
      const junkPayload: Record<string, unknown> = {};
      if (roundedScore !== null) {
        junkPayload.lead_score = roundedScore;
      }

      const { data: updatedCall, error: updateError } = await adminClient.rpc('apply_call_action_v1', {
        p_call_id: callId,
        p_action_type: 'junk',
        p_payload: junkPayload,
        p_actor_type: 'system',
        p_actor_id: user.id,
        p_metadata: { route, request_id: requestId, user_id: user.id },
        p_version: null,
      });

      if (updateError) {
        logWarn('gear_shift_junk_failed', {
          callId,
          actionType,
          error: updateError.message,
          code: (updateError as { code?: string }).code,
        });
        return NextResponse.json({ error: 'Failed to persist junk action' }, { status: 409 });
      }

      const persistedCall = resolvePersistedCall(updatedCall);
      if (!persistedCall) {
        logWarn('gear_shift_junk_missing_row', { callId, actionType });
        return NextResponse.json({ error: 'Junk action did not persist; please retry.' }, { status: 500 });
      }

      await invalidatePendingOciArtifactsForCall(callId, siteId, 'CALL_STATUS_REVERSED:JUNK', new Date().toISOString());

      return NextResponse.json({
        success: true,
        discarded: true,
        call: persistedCall,
        persisted_status: persistedCall.status ?? 'junk',
        queued: false,
      });
    }

    // Route phone through the canonical DIC normalize+hash SSOT so the stored
    // hash matches what the seal path / export pipeline would produce.
    let phoneHash: string | null = null;
    let phoneE164: string | null = null;
    let callerPhoneRaw: string | null = null;
    if (typeof phone === 'string' && phone.trim()) {
      const { data: siteRow } = await adminClient
        .from('sites')
        .select('default_country_iso')
        .eq('id', siteId)
        .maybeSingle();
      const countryIso = (siteRow as { default_country_iso?: string | null } | null)?.default_country_iso ?? 'TR';
      const identity = buildPhoneIdentity({ rawPhone: phone, countryIso });
      callerPhoneRaw = identity.raw || null;
      phoneE164 = identity.e164;
      phoneHash = identity.hash;
      if (identity.reason !== 'ok') {
        logWarn('PANEL_STAGE_PHONE_NORMALIZATION_DEGRADED', {
          call_id: callId,
          reason: identity.reason,
        });
      }
    }

    const optimizationStage = resolveOptimizationStage({
      actionType,
      leadScore: roundedScore,
    });
    const snapshot = buildOptimizationSnapshot({
      stage: optimizationStage,
      systemScore: roundedScore ?? 0,
      helperFormPayload,
    });

    const isWonStage = optimizationStage === 'won';
    const confirmPayload: Record<string, unknown> = {
      status: isWonStage ? 'confirmed' : 'intent',
      oci_status: isWonStage ? 'sealed' : 'intent',
    };
    if (roundedScore !== null) {
      confirmPayload.lead_score = roundedScore;
    }
    if (callerPhoneRaw) {
      confirmPayload.caller_phone_raw = callerPhoneRaw;
    }
    if (phoneE164) {
      confirmPayload.caller_phone_e164 = phoneE164;
      confirmPayload.phone_source_type = 'operator_verified';
    }
    if (phoneHash) {
      confirmPayload.caller_phone_hash_sha256 = phoneHash;
    }

    // Mark call as confirmed locally before enqueueing OCI
    const { data: updatedCall, error: updateError } = await adminClient.rpc('apply_call_action_v1', {
      p_call_id: callId,
      p_action_type: 'confirm',
      p_payload: confirmPayload,
      p_actor_type: 'system',
      p_actor_id: user.id,
      p_metadata: { route, score: roundedScore, action_type: actionType, request_id: requestId },
      p_version: null,
    });

    if (updateError) {
      logWarn('gear_shift_confirm_failed', {
        callId,
        score: roundedScore,
        actionType,
        error: updateError.message,
        code: (updateError as { code?: string }).code,
      });
      return NextResponse.json({ error: 'Failed to persist confirmation' }, { status: 409 });
    }

    const persistedCall = resolvePersistedCall(updatedCall);
    if (!persistedCall) {
      logWarn('gear_shift_confirm_missing_row', { callId, score: roundedScore, actionType });
      return NextResponse.json({ error: 'Confirmation did not persist; please retry.' }, { status: 500 });
    }

    // Phase 4 f4-notify-outbox: real-time trigger for the outbox processor so
    // the QStash worker picks up the freshly inserted IntentSealed row within
    // seconds instead of waiting for the cron poll.
    void notifyOutboxPending({ callId, siteId, source: 'panel_stage' });

    const nowIso = new Date().toISOString();
    await adminClient
      .from('calls')
      .update({
        optimization_stage: snapshot.optimizationStage,
        system_score: snapshot.systemScore,
        quality_factor: snapshot.qualityFactor,
        optimization_value: snapshot.optimizationValue,
        actual_revenue: snapshot.actualRevenue,
        helper_form_payload: snapshot.helperFormPayload,
        feature_snapshot: {
          source: 'panel_stage_route',
          action_type: actionType,
        },
        outcome_timestamp: nowIso,
        model_version: snapshot.modelVersion,
      })
      .eq('id', callId)
      .eq('site_id', siteId);

    if (isWonStage) {
      const enqueueResult = await enqueueSealConversion({
        callId,
        siteId,
        confirmedAt: nowIso,
        saleOccurredAt: nowIso,
        saleAmount: null,
        currency: normalizeCurrencyOrNeutral((call as { currency?: string | null }).currency),
        leadScore: snapshot.systemScore,
        helperFormPayload,
      });
      if (!enqueueResult.enqueued && enqueueResult.reason !== 'duplicate') {
        logWarn('gear_shift_sale_enqueue_failed', {
          callId,
          reason: enqueueResult.reason,
          error: enqueueResult.error,
        });
      }
    } else if (optimizationStage === 'contacted' || optimizationStage === 'offered') {
      const clickIds = {
        gclid: (call as { gclid?: string | null }).gclid?.trim() || null,
        wbraid: (call as { wbraid?: string | null }).wbraid?.trim() || null,
        gbraid: (call as { gbraid?: string | null }).gbraid?.trim() || null,
      };

      await upsertMarketingSignal({
        source: 'panel_stage',
        siteId,
        callId,
        traceId: requestId ?? null,
        stage: optimizationStage,
        signalDate: new Date(nowIso),
        snapshot,
        clickIds,
        featureSnapshotExtras: { action_type: actionType },
        causalDna: {
          origin: 'PANEL_STAGE_ROUTE',
          optimization_stage: snapshot.optimizationStage,
          system_score: snapshot.systemScore,
        },
      });
    }

    return NextResponse.json({
      success: true,
      call: persistedCall,
      persisted_status: persistedCall.status ?? 'confirmed',
      queued: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    logError(message, { request_id: requestId, route });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
