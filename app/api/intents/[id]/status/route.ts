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

export const dynamic = 'force-dynamic';

const route = '/api/intents/[id]/status';

async function invalidatePendingOciArtifactsForCall(
  callId: string,
  siteId: string,
  reason: string,
  now: string
): Promise<void> {
  const [outboxResult, signalPendingResult, signalProcessingResult] = await Promise.all([
    adminClient
      .from('outbox_events')
      .update({
        status: 'FAILED',
        last_error: reason,
        processed_at: now,
      })
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .in('status', ['PENDING', 'PROCESSING']),
    adminClient
      .from('marketing_signals')
      .update({
        dispatch_status: 'JUNK_ABORTED',
      })
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .eq('dispatch_status', 'PENDING'),
    adminClient
      .from('marketing_signals')
      .update({
        dispatch_status: 'FAILED',
      })
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .eq('dispatch_status', 'PROCESSING'),
  ]);

  if (outboxResult.error) {
    logError('INVALIDATE_OCI_OUTBOX_FAILED', { call_id: callId, site_id: siteId, reason, error: outboxResult.error.message });
  }
  if (signalPendingResult.error) {
    logError('INVALIDATE_OCI_SIGNALS_PENDING_FAILED', { call_id: callId, site_id: siteId, reason, error: signalPendingResult.error.message });
  }
  if (signalProcessingResult.error) {
    logError('INVALIDATE_OCI_SIGNALS_PROCESSING_FAILED', { call_id: callId, site_id: siteId, reason, error: signalProcessingResult.error.message });
  }
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

    // Lookup site_id (do not trust client). Then validate access using server gate (owner/admin/member).
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
    const access = await validateSiteAccess(siteId, user.id, supabase);
    if (!access.allowed) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    if (!access.role || !hasCapability(access.role, 'queue:operate')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Route through DB-owned actions so audit log + revert snapshot remain authoritative.
    // This endpoint is primarily used for junk/restore/cancel flows; seal happens via /api/calls/[id]/seal.
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

    const payload: Record<string, unknown> = {};
    if (lead_score !== undefined) payload.lead_score = lead_score;

    // Use adminClient (service_role) so the write is not blocked by RLS. We already validated
    // site access and queue:operate; without this, member role 'owner' or RLS can prevent UPDATE.
    //
    // IMPORTANT: apply_call_action_v1 / undo_last_action_v1 resolve p_actor_type='user' via auth.uid().
    // A service-role RPC has no auth.uid(), so "user" would deterministically raise unauthorized and
    // bubble up to the UI as "Failed to update status". For server-owned mutations we must call the RPC
    // as a normalized system actor while still preserving the human actor id for audit lineage.
    //
    // Restore must go through undo_last_action_v1; apply_call_action_v1 has no restore branch.
    const metadata = { route, request_id: requestId, user_id: user.id };
    const rpcName = actionType === 'restore' ? 'undo_last_action_v1' : 'apply_call_action_v1';
    const rpcArgs = actionType === 'restore'
      ? {
          p_call_id: callId,
          p_actor_type: 'system',
          p_actor_id: user.id,
          p_metadata: metadata,
        }
      : {
          p_call_id: callId,
          p_action_type: actionType,
          p_payload: payload,
          p_actor_type: 'system',
          p_actor_id: user.id,
          p_metadata: metadata,
          p_version: null,
        };

    const { data: updatedCall, error: updateError } = await adminClient.rpc(rpcName, rpcArgs);

    if (updateError) {
      logError('intent status update failed', {
        request_id: requestId,
        route,
        call_id: callId,
        action_type: actionType,
        error: updateError.message,
        code: (updateError as { code?: string }).code,
      });
      return NextResponse.json(
        { error: 'Failed to update status' },
        { status: 500 }
      );
    }

    const callObj = Array.isArray(updatedCall) && updatedCall.length === 1 ? updatedCall[0] : updatedCall;
    if (!callObj || (typeof callObj === 'object' && !('id' in callObj))) {
      logError('intent status update returned no row', { request_id: requestId, route, callId, actionType });
      return NextResponse.json(
        { error: 'Update did not persist; please retry.' },
        { status: 500 }
      );
    }

    if (actionType === 'restore' || actionType === 'cancel' || actionType === 'junk') {
      const now = new Date().toISOString();
      await invalidatePendingOciArtifactsForCall(callId, siteId, `CALL_STATUS_REVERSED:${actionType.toUpperCase()}`, now);
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
