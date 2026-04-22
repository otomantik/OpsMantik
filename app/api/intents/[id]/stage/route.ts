import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { logError, logWarn } from '@/lib/logging/logger';
import { hasCapability } from '@/lib/auth/rbac';
import { invalidatePendingOciArtifactsForCall } from '@/lib/oci/invalidate-pending-artifacts';
import {
  resolveOptimizationStage,
  sanitizeHelperFormPayload,
} from '@/lib/oci/optimization-contract';
import { buildPhoneIdentity } from '@/lib/dic/phone-hash';
import { notifyOutboxPending } from '@/lib/oci/notify-outbox';
import { resolveMutationVersion } from '@/lib/integrity/mutation-version';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';

export const dynamic = 'force-dynamic';

const route = '/api/intents/[id]/stage';

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
    
    // helperFormPayload sanitized but currently passed via v2 RPC metadata or lead_score
    sanitizeHelperFormPayload(
      body.helper_form_payload && typeof body.helper_form_payload === 'object'
        ? body.helper_form_payload
        : null
    );

    if (roundedScore === null && !actionType) {
      return NextResponse.json({ error: 'score or action_type is required' }, { status: 400 });
    }

    const { data: call, error: callError } = await adminClient
      .from('calls')
      .select('id, site_id, version, matched_session_id, currency, gclid, wbraid, gbraid, optimization_stage')
      .eq('id', callId)
      .single();

    if (callError || !call) {
      return NextResponse.json({ error: 'Call not found' }, { status: 404 });
    }

    const siteId = call.site_id;
    const rowVersion =
      typeof (call as { version?: unknown }).version === 'number' &&
      Number.isFinite((call as { version: number }).version)
        ? Math.round((call as { version: number }).version)
        : null;
    const access = await validateSiteAccess(siteId, user.id, supabase);
    if (!access.allowed || !access.role || !hasCapability(access.role, 'queue:operate')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const versionResolution = resolveMutationVersion({
      rawVersion: (body as { version?: unknown }).version,
      route,
      siteId,
      requestHeaders: req.headers,
      fallbackVersion: rowVersion,
      requestId,
    });
    if (!versionResolution.ok) {
      return NextResponse.json(
        { error: 'version must be an integer >= 1', code: 'INVALID_VERSION' },
        { status: 400 }
      );
    }

    const optimizationStage = resolveOptimizationStage({
      actionType,
      leadScore: roundedScore,
    });

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
    }

    // Phase 2: Authoritative SQL FSM — Unified Path
    const { data: updatedCall, error: updateError } = await adminClient.rpc('apply_call_action_v2', {
      p_call_id: callId,
      p_site_id: siteId,
      p_stage: optimizationStage,
      p_actor_id: user.id,
      p_lead_score: roundedScore,
      p_version: versionResolution.version,
      p_metadata: {
        route,
        score: roundedScore,
        action_type: actionType,
        request_id: requestId,
        mutation_origin: 'user',
      },
      p_caller_phone_raw: callerPhoneRaw,
      p_caller_phone_e164: phoneE164,
      p_caller_phone_hash: phoneHash,
    });

    if (updateError) {
      const code = (updateError as { code?: string }).code;
      if (code === '40900') {
        incrementRefactorMetric('mutation_conflict_total');
        return NextResponse.json(
          {
            error: 'Concurrency conflict: the call state has changed. Please refresh.',
            code: 'CONCURRENCY_CONFLICT',
            latest_version_hint: rowVersion,
          },
          { status: 409 }
        );
      }
      logWarn('stage_v2_failed', { callId, optimizationStage, error: updateError.message });
      return NextResponse.json({ error: updateError.message, code: 'RPC_V2_FAILURE' }, { status: 409 });
    }

    const callObj = updatedCall;
    if (optimizationStage === 'junk') {
      await invalidatePendingOciArtifactsForCall(callId, siteId, 'CALL_STATUS_REVERSED:JUNK', new Date().toISOString());
    }

    void notifyOutboxPending({ callId, siteId, source: 'panel_stage_v2' });

    return NextResponse.json({
      success: true,
      call: callObj,
      persisted_status: (callObj as { status?: string }).status ?? 'intent',
      queued: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    logError(message, { request_id: requestId, route });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
