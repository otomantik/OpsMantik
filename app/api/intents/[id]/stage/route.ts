import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { logError, logWarn } from '@/lib/logging/logger';
import { hasCapability } from '@/lib/auth/rbac';
import { invalidatePendingOciArtifactsForCall } from '@/lib/oci/invalidate-pending-artifacts';
import { resolveOptimizationStage } from '@/lib/oci/optimization-contract';
import { buildPhoneIdentity } from '@/lib/dic/phone-hash';
import { notifyOutboxPending } from '@/lib/oci/notify-outbox';
import { resolveMutationVersion } from '@/lib/integrity/mutation-version';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { cookies } from 'next/headers';
import {
  getPanelPreviewCookieName,
  verifyPanelPreviewContext,
} from '@/lib/auth/panel-preview-context';

export const dynamic = 'force-dynamic';

const route = '/api/intents/[id]/stage';
const PANEL_API_VERSION = '2026-05-01';

const isPanelApiVersionAccepted = (headerValue: string | null): boolean => {
  if (!headerValue) return false;
  const normalized = headerValue.trim();
  return normalized === PANEL_API_VERSION || normalized === '1';
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = req.headers.get('x-request-id') ?? undefined;
  try {
    const apiVersionHeader = req.headers.get('x-ops-api-version');
    if (!isPanelApiVersionAccepted(apiVersionHeader)) {
      incrementRefactorMetric('panel_stage_api_version_mismatch_total');
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported API version for panel stage route. Expected ${PANEL_API_VERSION}.`,
          code: 'API_VERSION_MISMATCH',
          request_id: requestId,
        },
        { status: 409 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', code: 'UNAUTHORIZED', request_id: requestId },
        { status: 401 }
      );
    }

    const bodyUnknown = await req.json().catch(() => ({}));
    const body =
      bodyUnknown && typeof bodyUnknown === 'object' && !Array.isArray(bodyUnknown)
        ? (bodyUnknown as Record<string, unknown>)
        : {};
    const phone = typeof body.phone === 'string' ? body.phone : null;
    const score = typeof body.score === 'number' ? body.score : null;
    const action_type = typeof body.action_type === 'string' ? body.action_type : null;
    const { id: callId } = await params;
    const actionType = typeof action_type === 'string' ? action_type.trim().toLowerCase() : null;
    const roundedScore = typeof score === 'number' ? Math.max(0, Math.min(100, Math.round(score))) : null;

    if (roundedScore === null && !actionType) {
      return NextResponse.json(
        {
          success: false,
          error: 'score or action_type is required',
          code: 'INVALID_PAYLOAD',
          request_id: requestId,
        },
        { status: 400 }
      );
    }

    const { data: call, error: callError } = await adminClient
      .from('calls')
      .select('id, site_id, version, matched_session_id, currency, gclid, wbraid, gbraid, optimization_stage')
      .eq('id', callId)
      .single();

    if (callError || !call) {
      incrementRefactorMetric('panel_stage_404_total');
      return NextResponse.json(
        { success: false, error: 'Call not found', code: 'CALL_NOT_FOUND', request_id: requestId },
        { status: 404 }
      );
    }

    const siteId = call.site_id;
    const rowVersion =
      typeof (call as { version?: unknown }).version === 'number' &&
      Number.isFinite((call as { version: number }).version)
        ? Math.round((call as { version: number }).version)
        : null;
    const access = await validateSiteAccess(siteId, user.id, supabase);
    if (!access.allowed || !access.role || !hasCapability(access.role, 'queue:operate')) {
      return NextResponse.json(
        { success: false, error: 'Access denied', code: 'ACCESS_DENIED', request_id: requestId },
        { status: 403 }
      );
    }
    const cookieStore = await cookies();
    const previewToken = cookieStore.get(getPanelPreviewCookieName())?.value ?? '';
    if (previewToken) {
      const preview = await verifyPanelPreviewContext(previewToken);
      if (preview && preview.userId === user.id && preview.siteId === siteId && preview.scope === 'ro') {
        return NextResponse.json(
          { success: false, error: 'READ_ONLY_SCOPE', code: 'READ_ONLY_SCOPE', request_id: requestId },
          { status: 403 }
        );
      }
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
        {
          success: false,
          error: 'version must be an integer >= 1',
          code: 'INVALID_VERSION',
          request_id: requestId,
        },
        { status: 400 }
      );
    }

    const optimizationStage = resolveOptimizationStage({
      actionType,
      leadScore: roundedScore,
    });

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

    const rpcPayloadBase = {
      p_call_id: callId,
      p_site_id: siteId,
      p_stage: optimizationStage,
      p_actor_id: user.id,
      p_lead_score: roundedScore,
      p_version: versionResolution.version,
      p_reviewed: true,
      p_metadata: {
        route,
        score: roundedScore,
        action_type: actionType,
        request_id: requestId,
        mutation_origin: 'user',
      },
    };
    const rpcPayloadWithCaller = {
      ...rpcPayloadBase,
      p_caller_phone_raw: callerPhoneRaw,
      p_caller_phone_e164: phoneE164,
      p_caller_phone_hash: phoneHash,
    };
    let { data: updatedCall, error: updateError } = await adminClient.rpc(
      'apply_call_action_with_review_v1',
      rpcPayloadWithCaller
    );

    const isLegacySignatureMissing = (err: { code?: string; message?: string } | null): boolean => {
      if (!err) return false;
      const msg = (err.message || '').toLowerCase();
      return err.code === 'PGRST202' && msg.includes('apply_call_action_with_review_v1');
    };

    if (isLegacySignatureMissing(updateError as { code?: string; message?: string } | null)) {
      incrementRefactorMetric('panel_stage_rpc_signature_mismatch_total');
      const retry = await adminClient.rpc('apply_call_action_with_review_v1', rpcPayloadBase);
      updatedCall = retry.data;
      updateError = retry.error;
    }

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
      return NextResponse.json(
        {
          success: false,
          error: updateError.message,
          code: 'RPC_V2_FAILURE',
          request_id: requestId,
        },
        { status: 409 }
      );
    }

    const callObj = updatedCall;
    const persistedStatus = (callObj as { status?: string }).status ?? 'intent';
    if (persistedStatus === 'intent') {
      incrementRefactorMetric('panel_stage_persistence_miss_total');
      logWarn('panel_stage_persistence_miss', {
        request_id: requestId,
        route,
        call_id: callId,
        site_id: siteId,
        status: persistedStatus,
      });
    } else {
      incrementRefactorMetric('panel_stage_success_total');
    }
    if (optimizationStage === 'junk') {
      await invalidatePendingOciArtifactsForCall(callId, siteId, 'CALL_STATUS_REVERSED:JUNK', new Date().toISOString());
    }

    void notifyOutboxPending({ callId, siteId, source: 'panel_stage_v2' });

    return NextResponse.json({
      success: true,
      call: callObj,
      persisted_status: persistedStatus,
      queued: true,
      code: 'OK',
      request_id: requestId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    logError(message, { request_id: requestId, route });
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        request_id: requestId,
      },
      { status: 500 }
    );
  }
}
