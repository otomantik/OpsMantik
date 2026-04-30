import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { hasCapability } from '@/lib/auth/rbac';
import { logError, logInfo } from '@/lib/logging/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = req.headers.get('x-request-id') ?? undefined;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const bodyUnknown = await req.json().catch(() => ({}));
    const body =
      bodyUnknown && typeof bodyUnknown === 'object' && !Array.isArray(bodyUnknown)
        ? (bodyUnknown as Record<string, unknown>)
        : {};
    const sourceSurface =
      typeof body.source_surface === 'string' && body.source_surface.trim()
        ? body.source_surface.trim().slice(0, 80)
        : 'qualification-queue';

    const { id: callId } = await params;
    const { data: call, error: callErr } = await adminClient
      .from('calls')
      .select('id, site_id, status, reviewed_at, matched_session_id, canonical_intent_key')
      .eq('id', callId)
      .single();
    if (callErr || !call) return NextResponse.json({ error: 'Call not found' }, { status: 404 });

    const access = await validateSiteAccess(call.site_id, user.id, supabase);
    if (!access.allowed || !access.role || !hasCapability(access.role, 'queue:operate')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const status = String(call.status || '').toLowerCase();
    if (status && status !== 'intent' && status !== 'contacted') {
      return NextResponse.json(
        { error: 'Only intent/contacted status can be marked reviewed', code: 'ILLEGAL_REVIEW_STATE' },
        { status: 409 }
      );
    }

    const reviewedAt = new Date().toISOString();
    const { error: upErr } = await adminClient
      .from('calls')
      .update({ reviewed_at: reviewedAt, reviewed_by: user.id })
      .eq('id', callId)
      .eq('site_id', call.site_id)
      .is('reviewed_at', null);
    if (upErr) {
      logError('INTENT_MARK_REVIEWED_FAILED', {
        request_id: requestId,
        call_id: callId,
        site_id: call.site_id,
        error: upErr.message,
      });
      return NextResponse.json({ error: 'Failed to mark reviewed' }, { status: 500 });
    }

    logInfo('INTENT_MARK_REVIEWED', {
      request_id: requestId,
      site_id: call.site_id,
      intent_id: callId,
      call_id: callId,
      matched_session_id: call.matched_session_id ?? null,
      source_surface: sourceSurface,
      status: call.status ?? null,
      reviewed_at: reviewedAt,
      dedupe_key: call.canonical_intent_key ?? null,
      actor: user.id,
    });

    return NextResponse.json({ ok: true, reviewed_at: reviewedAt, reviewed_by: user.id });
  } catch (err) {
    logError('INTENT_MARK_REVIEWED_ERROR', {
      request_id: requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

