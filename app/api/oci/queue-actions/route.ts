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
import { QueueActionsBodySchema, QUEUE_STATUSES } from '@/lib/domain/oci/queue-types';
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
  const now = new Date().toISOString();

  if (ids.length === 0) {
    return NextResponse.json({ ok: true, affected: 0 });
  }

  const validIds = ids.filter((id) => typeof id === 'string' && id.length > 0);
  if (validIds.length === 0) {
    return NextResponse.json({ ok: true, affected: 0 });
  }

  let updatePayload: Record<string, unknown>;
  let statusFilter: string[];

  switch (action) {
    case 'RETRY_SELECTED': {
      statusFilter = ['FAILED', 'RETRY'];
      updatePayload = {
        status: 'QUEUED',
        claimed_at: null,
        next_retry_at: null,
        updated_at: now,
      };
      break;
    }
    case 'RESET_TO_QUEUED': {
      statusFilter = ['QUEUED', 'RETRY', 'PROCESSING', 'FAILED'];
      updatePayload = {
        status: 'QUEUED',
        claimed_at: null,
        next_retry_at: null,
        updated_at: now,
      };
      if (clearErrors) {
        updatePayload.last_error = null;
        updatePayload.provider_error_code = null;
        updatePayload.provider_error_category = null;
      }
      break;
    }
    case 'MARK_FAILED': {
      statusFilter = ['PROCESSING', 'QUEUED', 'RETRY'];
      const code = errorCode ?? MARK_FAILED_DEFAULTS.errorCode;
      const category = errorCategory ?? MARK_FAILED_DEFAULTS.errorCategory;
      const msg = reason ?? MARK_FAILED_DEFAULTS.reason;
      updatePayload = {
        status: 'FAILED',
        last_error: msg.slice(0, 1024),
        provider_error_code: code.slice(0, 64),
        provider_error_category: category,
        updated_at: now,
      };
      break;
    }
    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const { data, error } = await adminClient
    .from('offline_conversion_queue')
    .update(updatePayload)
    .in('id', validIds)
    .eq('site_id', siteUuid)
    .in('status', statusFilter)
    .select('id');

  if (error) {
    return NextResponse.json(
      { error: 'Something went wrong', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }

  const affected = Array.isArray(data) ? data.length : 0;
  return NextResponse.json({ ok: true, affected });
}
