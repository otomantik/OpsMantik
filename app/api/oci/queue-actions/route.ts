/**
 * POST /api/oci/queue-actions
 * OCI Control: RETRY_SELECTED, RESET_TO_QUEUED, MARK_FAILED.
 * Deterministic: when setting QUEUED, also set claimed_at=NULL, next_retry_at=NULL.
 * MARK_FAILED defaults: errorCode=MANUAL_FAIL, errorCategory=PERMANENT, reason=MANUALLY_MARKED_FAILED.
 * Auth: session + validateSiteAccess.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireOciControlAuth } from '@/lib/oci/control-auth';
import { QueueActionsBodySchema } from '@/lib/domain/oci/queue-types';
import type { ProviderErrorCategory } from '@/lib/domain/oci/queue-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MARK_FAILED_DEFAULTS = {
  errorCode: 'MANUAL_FAIL',
  errorCategory: 'PERMANENT' as ProviderErrorCategory,
  reason: 'MANUALLY_MARKED_FAILED',
};

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = QueueActionsBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const auth = await requireOciControlAuth(parsed.data.siteId);
  if (auth instanceof NextResponse) return auth;
  const siteUuid = auth.siteUuid;

  const { action, ids, reason, errorCode, errorCategory, clearErrors } = parsed.data;

  if (ids.length === 0) {
    return NextResponse.json({ ok: true, affected: 0 });
  }

  const validIds = ids.filter((id) => typeof id === 'string' && id.length > 0);
  if (validIds.length === 0) {
    return NextResponse.json({ ok: true, affected: 0 });
  }

  // Use RPC with row-level locking (FOR UPDATE) to prevent concurrent mutations.
  const { data: affected, error } = await adminClient.rpc('update_queue_status_locked', {
    p_ids: validIds,
    p_site_id: siteUuid,
    p_action: action,
    p_clear_errors: clearErrors ?? false,
    p_error_code: (errorCode ?? MARK_FAILED_DEFAULTS.errorCode).slice(0, 64),
    p_error_category: errorCategory ?? MARK_FAILED_DEFAULTS.errorCategory,
    p_reason: (reason ?? MARK_FAILED_DEFAULTS.reason).slice(0, 1024),
  });

  if (error) {
    return NextResponse.json(
      { error: 'Something went wrong', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, affected: typeof affected === 'number' ? affected : 0 });
}
