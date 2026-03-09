import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { hasCapability } from '@/lib/auth/rbac';
import { appendAuditLog } from '@/lib/audit/audit-log';
import { getBuildInfoHeaders } from '@/lib/build-info';

type ReviewAction = 'approve' | 'reject';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: saleId } = await params;
  if (!saleId) {
    return NextResponse.json({ error: 'sale_id is required' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: getBuildInfoHeaders() });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? '').trim().toLowerCase() as ReviewAction;
  const reviewReason =
    typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : null;
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const { data: sale } = await adminClient
    .from('sales')
    .select('id, site_id, status, occurred_at, amount_cents, currency, entry_reason, approval_requested_at')
    .eq('id', saleId)
    .maybeSingle();

  if (!sale) {
    return NextResponse.json({ error: 'Sale not found' }, { status: 404, headers: getBuildInfoHeaders() });
  }

  const siteId = (sale as { site_id: string }).site_id;
  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed || !access.role || !hasCapability(access.role, 'site:write')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: getBuildInfoHeaders() });
  }

  const currentStatus = (sale as { status: string }).status;
  if (currentStatus !== 'PENDING_APPROVAL') {
    return NextResponse.json(
      { error: 'Sale is not pending approval', code: 'SALE_NOT_PENDING_APPROVAL' },
      { status: 409, headers: getBuildInfoHeaders() }
    );
  }

  const nextStatus = action === 'approve' ? 'DRAFT' : 'CANCELED';
  const nowIso = new Date().toISOString();
  const { data: updated, error: updateError } = await adminClient
    .from('sales')
    .update({
      status: nextStatus,
      approval_requested_at: null,
      updated_at: nowIso,
    })
    .eq('id', saleId)
    .eq('site_id', siteId)
    .select('id, site_id, status, occurred_at, amount_cents, currency, entry_reason')
    .single();

  if (updateError || !updated) {
    const { sanitizeErrorForClient } = await import('@/lib/security/sanitize-error');
    return NextResponse.json({ error: updateError ? sanitizeErrorForClient(updateError) : 'Update failed' }, { status: 500, headers: getBuildInfoHeaders() });
  }

  await appendAuditLog(adminClient, {
    actor_type: 'user',
    actor_id: user.id,
    action: action === 'approve' ? 'sale_time_approved' : 'sale_time_rejected',
    resource_type: 'sale',
    resource_id: saleId,
    site_id: siteId,
    payload: {
      reason: reviewReason,
      previous_status: currentStatus,
      next_status: nextStatus,
      occurred_at: (updated as { occurred_at?: string | null }).occurred_at ?? null,
      entry_reason: (updated as { entry_reason?: string | null }).entry_reason ?? null,
    },
  });

  return NextResponse.json(
    {
      success: true,
      action,
      sale: {
        id: (updated as { id: string }).id,
        status: (updated as { status: string }).status,
      },
    },
    { status: 200, headers: getBuildInfoHeaders() }
  );
}
