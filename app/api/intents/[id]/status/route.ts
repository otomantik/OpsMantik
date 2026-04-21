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

    const body = await req.json();
    const { status, lead_score } = body;
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
      .select('id, site_id')
      .eq('id', callId)
      .single();

    if (callError || !call) {
      return NextResponse.json(
        { error: 'Call not found' },
        { status: 404 }
      );
    }

    const siteId = call.site_id;

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

    // Phase 2: Authoritative SQL FSM
    // Redundant TS-level check removed.
    const { data: updatedCall, error: updateError } = await adminClient.rpc('apply_call_action_v2', {
      p_call_id: callId,
      p_site_id: siteId,
      p_stage: targetStage,
      p_actor_id: user.id,
      p_lead_score: lead_score !== undefined ? lead_score : null,
      p_version: body.version ?? null, // Use version for optimistic concurrency
      p_metadata: { route, request_id: requestId, user_id: user.id },
    });

    if (updateError) {
      const code = (updateError as { code?: string }).code;
      if (code === '40900') {
        return NextResponse.json(
          { error: 'Concurrency conflict: the call state has changed. Please refresh.', code: 'CONCURRENCY_CONFLICT' },
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
        { error: 'Failed to update status' },
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

    return NextResponse.json({
      success: true,
      call: callObj,
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
