/**
 * API Route: Universal Gear Shift
 * 
 * Target: /api/intents/[id]/stage
 * Body: { gear_id: string, phone_hash?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { logError, logWarn } from '@/lib/logging/logger';
import { hasCapability } from '@/lib/auth/rbac';
import { buildMinimalCausalDna } from '@/lib/domain/mizan-mantik/causal-dna';
import { resolveConversionValueMinor } from '@/lib/domain/mizan-mantik';
import { invalidatePendingOciArtifactsForCall } from '@/lib/oci/invalidate-pending-artifacts';
import { majorToMinor } from '@/lib/i18n/currency';
import type { PipelineStage } from '@/lib/types/database';
import crypto from 'crypto';

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
    const { gear_id, phone, score, action_type } = body;
    const { id: callId } = await params;
    const actionType = typeof action_type === 'string' ? action_type.trim().toLowerCase() : null;
    const roundedScore = typeof score === 'number' ? Math.max(0, Math.min(100, Math.round(score))) : null;

    // We allow either gear_id OR a direct numeric score for the new panel
    if (!gear_id && roundedScore === null) {
      return NextResponse.json({ error: 'gear_id or score is required' }, { status: 400 });
    }

    const { data: call, error: callError } = await adminClient
      .from('calls')
      .select('id, site_id, matched_session_id')
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

    const { data: site } = await adminClient
      .from('sites')
      .select('pipeline_stages, oci_config, default_aov, currency')
      .eq('id', siteId)
      .single();

    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

    const pipelineStages = (site.pipeline_stages || []) as PipelineStage[];
    const stage = gear_id ? pipelineStages.find(s => s.id === gear_id) : null;

    // If using gear-based flow, stage is required. If using pure score, we proceed.
    if (gear_id && !stage) {
      return NextResponse.json({ error: 'Invalid gear_id for this site' }, { status: 400 });
    }

    const isJunkAction =
      actionType === 'junk'
      || (stage ? stage.action === 'discard' || stage.id === 'g_trash' || stage.id === 'junk' : false)
      || (!gear_id && roundedScore === 0);

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

    // Hash phone if provided
    let phoneHash: string | null = null;
    let callerPhoneRaw: string | null = null;
    if (phone && phone.trim()) {
      callerPhoneRaw = phone.trim().slice(0, 64);
      const normalizedPhone = callerPhoneRaw.replace(/[^\d+]/g, '');
      phoneHash = crypto.createHash('sha256').update(normalizedPhone).digest('hex');
    }

    const currencySafe = site.currency || 'TRY';
    const baseValueTry = (site.oci_config as Record<string, unknown>)?.base_deal_value_try as number || site.default_aov || 1000;
    const ratioOverride =
      roundedScore !== null
        ? roundedScore
        : stage
          ? typeof stage.multiplier === 'number'
            ? stage.multiplier
            : stage.value_cents
              ? stage.value_cents / 100 / baseValueTry
              : 0.05
          : 0;
    const valueMath = resolveConversionValueMinor({
      gear: 'V4_INTENT',
      currency: currencySafe,
      siteAovMinor: majorToMinor(baseValueTry, currencySafe),
      ratioOverride,
      decayOverride: 1,
      minimumValueMinor: 1,
    });
    const valueCents = valueMath.valueMinor;

    // The Unique OCI Deduplication ID incorporating gear_id or score
    const dedupeKey = gear_id || `score_${roundedScore}`;
    const sessionId = call.matched_session_id;
    const externalId = `google_ads:${dedupeKey}:${callId}:${sessionId || 'no-session'}`;

    const confirmPayload: Record<string, unknown> = {
      status: gear_id || 'confirmed_with_score',
      oci_status: 'sealed',
    };
    if (roundedScore !== null) {
      confirmPayload.lead_score = roundedScore;
    }
    if (callerPhoneRaw) {
      confirmPayload.caller_phone_raw = callerPhoneRaw;
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
      p_metadata: { route, gear_id, score: roundedScore, action_type: actionType, request_id: requestId },
      p_version: null,
    });

    if (updateError) {
      logWarn('gear_shift_confirm_failed', {
        callId,
        gear_id,
        score: roundedScore,
        actionType,
        error: updateError.message,
        code: (updateError as { code?: string }).code,
      });
      return NextResponse.json({ error: 'Failed to persist confirmation' }, { status: 409 });
    }

    const persistedCall = resolvePersistedCall(updatedCall);
    if (!persistedCall) {
      logWarn('gear_shift_confirm_missing_row', { callId, gear_id, score: roundedScore, actionType });
      return NextResponse.json({ error: 'Confirmation did not persist; please retry.' }, { status: 500 });
    }

    const nowIso = new Date().toISOString();

    const causalDna = buildMinimalCausalDna(
      roundedScore !== null ? 'SCORE_BASED_CONVERSION' : 'UNIVERSAL_GEAR_SHIFT',
      ['usage'],
      stage?.label || `Puan: ${roundedScore}`,
      { baseValueTry, ratio: valueMath.ratio, score: roundedScore },
      { valueCents, currency: currencySafe }
    );

    const { data: qResult, error: insertError } = await adminClient
      .from('offline_conversion_queue')
      .insert({
        site_id: siteId,
        call_id: callId,
        session_id: sessionId,
        provider_key: 'google_ads',
        external_id: externalId,
        conversion_time: nowIso,
        occurred_at: nowIso,
        value_cents: valueCents,
        currency: currencySafe,
        status: 'QUEUED',
        causal_dna: causalDna,
        entropy_score: 0,
        uncertainty_bit: false,
      })
      .select('id')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
         // It's a duplicate for EXACTLY this gear on this call. Just return 200.
         return NextResponse.json({
           success: true,
           duplicate: true,
           call: persistedCall,
           persisted_status: persistedCall.status ?? 'confirmed',
           queued: true,
         });
      }
      logWarn('gear_shift_oci_failed', { callId, gear_id, error: insertError.message });
      return NextResponse.json({ error: 'Failed to enqueue OCI' }, { status: 500 });
    }

    // Fast-track the worker to process it immediately without waiting for cron
    if (qResult && qResult.id) {
       try {
         const { publishToQStash } = await import('@/lib/ingest/publish');
         await publishToQStash({ lane: 'conversion', deduplicationId: `oci_export_${qResult.id}`, body: { kind: 'oci_export', queue_id: qResult.id } });
       } catch (err) {
         logWarn('gear_shift_fast_track_failed', { queue_id: qResult.id, error: err });
       }
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
