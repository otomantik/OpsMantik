/**
 * POST /api/conversations — create conversation with one primary entity (call or session) and first link.
 * Body: site_id, and exactly one of primary_call_id or primary_session_id. entity_type for link: call | session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { getPrimarySource } from '@/lib/conversation/primary-source';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: getBuildInfoHeaders() });
  }

  let body: { site_id?: string; primary_call_id?: string; primary_session_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const siteId = body.site_id;
  if (!siteId || typeof siteId !== 'string') {
    return NextResponse.json({ error: 'site_id is required' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: getBuildInfoHeaders() });
  }

  const hasCall = body.primary_call_id && typeof body.primary_call_id === 'string';
  const hasSession = body.primary_session_id && typeof body.primary_session_id === 'string';
  if (hasCall === hasSession) {
    return NextResponse.json(
      { error: 'Exactly one of primary_call_id or primary_session_id is required' },
      { status: 400, headers: getBuildInfoHeaders() }
    );
  }

  const primaryCallId = hasCall ? body.primary_call_id! : null;
  const primarySessionId = hasSession ? body.primary_session_id! : null;
  const primaryEntityType = primaryCallId ? 'call' : 'session';
  const primaryEntityId = primaryCallId ?? primarySessionId!;
  const primarySource = await getPrimarySource(siteId, {
    callId: primaryCallId ?? undefined,
    sessionId: primarySessionId ?? undefined,
  });

  const { data, error: convError } = await supabase.rpc('create_conversation_with_primary_entity', {
    p_site_id: siteId,
    p_primary_entity_type: primaryEntityType,
    p_primary_entity_id: primaryEntityId,
    p_primary_source: primarySource as Record<string, unknown> ?? null,
  });

  if (convError) {
    if (convError.code === '23505') {
      return NextResponse.json({ error: 'Conversation already exists for this primary entity' }, { status: 409, headers: getBuildInfoHeaders() });
    }
    if (convError.message === 'access_denied') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: getBuildInfoHeaders() });
    }
    if (convError.message === 'invalid_primary_entity_type' || convError.message === 'primary_entity_site_mismatch') {
      return NextResponse.json(
        { error: 'Primary entity not found or does not belong to this site', code: 'PRIMARY_ENTITY_SITE_MISMATCH' },
        { status: 400, headers: getBuildInfoHeaders() }
      );
    }
    return NextResponse.json({ error: convError.message }, { status: 500, headers: getBuildInfoHeaders() });
  }

  const conversation = Array.isArray(data) ? data[0] : data;
  if (!conversation || typeof conversation !== 'object') {
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500, headers: getBuildInfoHeaders() });
  }

  return NextResponse.json(conversation, { status: 201, headers: getBuildInfoHeaders() });
}
