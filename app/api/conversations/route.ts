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
  const primarySource = await getPrimarySource(siteId, {
    callId: primaryCallId ?? undefined,
    sessionId: primarySessionId ?? undefined,
  });

  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .insert({
      site_id: siteId,
      status: 'OPEN',
      primary_call_id: primaryCallId,
      primary_session_id: primarySessionId,
      primary_source: primarySource as Record<string, unknown> ?? null,
    })
    .select('id, site_id, status, primary_call_id, primary_session_id, primary_source, created_at, updated_at')
    .single();

  if (convError) {
    return NextResponse.json({ error: convError.message }, { status: 500, headers: getBuildInfoHeaders() });
  }

  const entityType = primaryCallId ? 'call' : 'session';
  const entityId = primaryCallId ?? primarySessionId!;
  const { error: linkError } = await supabase.from('conversation_links').insert({
    conversation_id: conversation.id,
    entity_type: entityType,
    entity_id: entityId,
  });

  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500, headers: getBuildInfoHeaders() });
  }

  return NextResponse.json(conversation, { status: 201, headers: getBuildInfoHeaders() });
}
