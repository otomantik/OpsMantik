import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { hasCapability } from '@/lib/auth/rbac';
import { appendAuditLog } from '@/lib/audit/audit-log';

export const dynamic = 'force-dynamic';

type ReviewAction = 'approve' | 'reject';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: callId } = await params;
  if (!callId) {
    return NextResponse.json({ error: 'Missing call id' }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const bodyUnknown = await req.json().catch(() => ({}));
  const body =
    bodyUnknown && typeof bodyUnknown === 'object' && !Array.isArray(bodyUnknown)
      ? (bodyUnknown as Record<string, unknown>)
      : {};
  const action = String(body.action ?? '').trim().toLowerCase() as ReviewAction;
  const reviewReason =
    typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : null;
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 });
  }

  const { data: call } = await adminClient
    .from('calls')
    .select('id, site_id, status, created_at, confirmed_at, lead_score, sale_amount, currency, sale_occurred_at, sale_source_timestamp, sale_time_confidence, sale_occurred_at_source, sale_entry_reason, sale_review_status, sale_review_requested_at')
    .eq('id', callId)
    .maybeSingle();

  if (!call) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  const siteId = (call as { site_id: string }).site_id;
  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed || !access.role || !hasCapability(access.role, 'site:write')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const reviewStatus = (call as { sale_review_status?: string | null }).sale_review_status ?? 'NONE';
  if (reviewStatus !== 'PENDING_APPROVAL') {
    return NextResponse.json(
      { error: 'Call sale time is not pending approval', code: 'CALL_SALE_NOT_PENDING_APPROVAL' },
      { status: 409 }
    );
  }
  const { data: updated, error: reviewError } = await adminClient.rpc('review_call_sale_time_v1', {
    p_call_id: callId,
    p_action: action,
    p_actor_id: user.id,
    p_metadata: {
      route: '/api/calls/[id]/sale-review',
      review_reason: reviewReason,
    },
  });

  if (reviewError) {
    if (reviewError.message?.includes('call_sale_not_pending_approval')) {
      return NextResponse.json(
        { error: 'Call sale time is not pending approval', code: 'CALL_SALE_NOT_PENDING_APPROVAL' },
        { status: 409 }
      );
    }
    if (reviewError.message?.includes('invalid_review_action')) {
      return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 });
    }
    const { sanitizeErrorForClient } = await import('@/lib/security/sanitize-error');
    return NextResponse.json({ error: sanitizeErrorForClient(reviewError) || 'Update failed' }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  const updatedCall = Array.isArray(updated) && updated.length === 1 ? updated[0] : updated;
  const nextReviewStatus = (updatedCall as { sale_review_status?: string | null }).sale_review_status ?? (action === 'approve' ? 'APPROVED' : 'REJECTED');
  const nextOciStatus = (updatedCall as { oci_status?: string | null }).oci_status ?? (action === 'approve' ? 'sealed' : 'pending_approval');

  await appendAuditLog(adminClient, {
    actor_type: 'user',
    actor_id: user.id,
    action: action === 'approve' ? 'call_sale_time_approved' : 'call_sale_time_rejected',
    resource_type: 'call',
    resource_id: callId,
    site_id: siteId,
    payload: {
      reason: reviewReason,
      sale_occurred_at: (updatedCall as { sale_occurred_at?: string | null }).sale_occurred_at ?? null,
      previous_review_status: reviewStatus,
      next_review_status: nextReviewStatus,
      next_oci_status: nextOciStatus,
    },
  });

  return NextResponse.json({
    success: true,
    action,
    call: {
      id: (updatedCall as { id: string }).id,
      sale_review_status: (updatedCall as { sale_review_status?: string | null }).sale_review_status ?? nextReviewStatus,
      oci_status: (updatedCall as { oci_status?: string | null }).oci_status ?? nextOciStatus,
      sale_occurred_at: (updatedCall as { sale_occurred_at?: string | null }).sale_occurred_at ?? null,
    },
  });
}
