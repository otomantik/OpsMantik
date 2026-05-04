/**
 * API Route: Update Intent Status
 * 
 * Updates the status of a call (intent) in the calls table.
 * 
 * POST /api/intents/[id]/status
 * Body: { status: 'confirmed' | 'qualified' | 'real' | 'junk' | 'suspicious' | 'cancelled' | 'intent' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { logInfo, logError } from '@/lib/logging/logger';
import * as Sentry from '@sentry/nextjs';
import { hasCapability } from '@/lib/auth/rbac';
import { invalidatePendingOciArtifactsForCall } from '@/lib/oci/invalidate-pending-artifacts';
import { notifyOutboxPending } from '@/lib/oci/notify-outbox';
import { triggerOutboxNowBestEffort } from '@/lib/oci/outbox/trigger-now';
import {
  enqueuePanelStageOciOutbox,
  type PanelReturnedCall,
} from '@/lib/oci/enqueue-panel-stage-outbox';
import { resolveMutationVersion } from '@/lib/integrity/mutation-version';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { buildCanonicalIntentKey } from '@/lib/intents/canonical-intent-key';

export const dynamic = 'force-dynamic';

const route = '/api/intents/[id]/status';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = req.headers.get('x-request-id') ?? undefined;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    logInfo('intent status request', { request_id: requestId, route, user_id: user.id });

    const bodyUnknown = await req.json().catch(() => ({}));
    const body =
      bodyUnknown && typeof bodyUnknown === 'object' && !Array.isArray(bodyUnknown)
        ? (bodyUnknown as Record<string, unknown>)
        : {};
    const status = typeof body.status === 'string' ? body.status : null;
    const lead_score = typeof body.lead_score === 'number' ? body.lead_score : null;
    const sourceSurface = typeof body.source_surface === 'string' && body.source_surface.trim()
      ? body.source_surface.trim().slice(0, 80)
      : 'dashboard.queue';
    const { id: callId } = await params;

    // Validate status
    const validStatuses = ['confirmed', 'qualified', 'real', 'junk', 'suspicious', 'cancelled', 'intent'];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      );
    }

    // Lookup site_id (do not trust client).
    const { data: call, error: callError } = await adminClient
      .from('calls')
      .select('id, site_id, version, matched_session_id, intent_action, created_at, status, reviewed_at')
      .eq('id', callId)
      .single();

    if (callError || !call) {
      return NextResponse.json(
        { error: 'Call not found' },
        { status: 404 }
      );
    }

    const siteId = call.site_id;
    const dedupeKey = buildCanonicalIntentKey({
      callId,
      siteId,
      matchedSessionId: (call as { matched_session_id?: string | null }).matched_session_id ?? null,
      intentAction: (call as { intent_action?: string | null }).intent_action ?? null,
      occurredAt: (call as { created_at?: string | null }).created_at ?? null,
    });

    // ... (access validation) ...
    const access = await validateSiteAccess(siteId, user.id, supabase);
    if (!access.allowed) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    if (!access.role || !hasCapability(access.role, 'queue:operate')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Resolve target stage based on action
    const actionType =
      status === 'junk'
        ? 'junk'
        : status === 'cancelled'
          ? 'cancel'
          : status === 'intent'
            ? 'restore'
            : null;

    if (!actionType) {
      return NextResponse.json(
        { error: 'Unsupported status for this endpoint (use /api/calls/[id]/seal for confirmations)' },
        { status: 400 }
      );
    }

    const targetStage = actionType === 'restore' ? 'contacted' : 'junk';

    const rowVersion =
      typeof (call as { version?: unknown }).version === 'number' &&
      Number.isFinite((call as { version: number }).version)
        ? Math.round((call as { version: number }).version)
        : null;
    const versionResolution = resolveMutationVersion({
      rawVersion: body.version,
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

    const { data: updatedCall, error: updateError } = await adminClient.rpc('apply_call_action_with_review_v1', {
      p_call_id: callId,
      p_site_id: siteId,
      p_stage: targetStage,
      p_actor_id: user.id,
      p_lead_score: lead_score !== undefined ? lead_score : null,
      p_version: versionResolution.version,
      p_reviewed: actionType !== 'restore',
      p_metadata: {
        route,
        request_id: requestId,
        user_id: user.id,
        mutation_origin: 'user',
        source_surface: sourceSurface,
        dedupe_key: dedupeKey,
      },
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
      if (code === 'P0001' && updateError.message.includes('illegal_transition')) {
        return NextResponse.json(
          { error: updateError.message, code: 'ILLEGAL_PIPELINE_TRANSITION' },
          { status: 409 }
        );
      }
      
      logError('intent status update failed', {
        request_id: requestId,
        route,
        call_id: callId,
        error: updateError.message,
        code,
      });
      return NextResponse.json(
        { error: 'Failed to update status', detail: updateError.message, code },
        { status: 500 }
      );
    }

    const callObj = updatedCall;
    if (!callObj || (typeof callObj === 'object' && !('id' in callObj))) {
      logError('intent status update returned no row', { request_id: requestId, route, callId, targetStage });
      return NextResponse.json(
        { error: 'Update did not persist; please retry.' },
        { status: 500 }
      );
    }

    if (targetStage === 'junk') {
      const now = new Date().toISOString();
      await invalidatePendingOciArtifactsForCall(callId, siteId, 'CALL_STATUS_REVERSED:JUNK', now);
    }

    const oci = await enqueuePanelStageOciOutbox(callObj as PanelReturnedCall, { requestId });
    if (!oci.ok) {
      incrementRefactorMetric('panel_stage_oci_producer_incomplete_total');
    }
    void notifyOutboxPending({ callId, siteId, source: 'panel_status_v1' });
    void triggerOutboxNowBestEffort({ callId, siteId, source: 'panel_status_v1' });

    logInfo('intent status mutation forensics', {
      request_id: requestId,
      route,
      site_id: siteId,
      intent_id: callId,
      call_id: callId,
      matched_session_id: (call as { matched_session_id?: string | null }).matched_session_id ?? null,
      source_surface: sourceSurface,
      query_params_snapshot: { status, lead_score },
      status_before: (call as { status?: string | null }).status ?? null,
      reviewed_at_before: (call as { reviewed_at?: string | null }).reviewed_at ?? null,
      dedupe_key: dedupeKey,
    });

    return NextResponse.json({
      success: true,
      call: callObj,
      queued: oci.outboxInserted,
      oci_outbox_inserted: oci.outboxInserted,
      oci_reconciliation_persisted:
        oci.reconciliationPersisted === undefined ? null : oci.reconciliationPersisted,
      oci_reconciliation_reason: oci.oci_reconciliation_reason,
      oci_enqueue_ok: oci.ok,
      request_id: requestId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    logError(message, { request_id: requestId, route });
    Sentry.captureException(error, { tags: { request_id: requestId, route } });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
