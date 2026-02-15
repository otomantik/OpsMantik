/**
 * POST /api/conversations/link — add a link (session | call | event) to a conversation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { getBuildInfoHeaders } from '@/lib/build-info';

export const runtime = 'nodejs';

const ALLOWED_ENTITY_TYPES = ['session', 'call', 'event'];

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: getBuildInfoHeaders() });
  }

  let body: { conversation_id?: string; entity_type?: string; entity_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const conversationId = body.conversation_id;
  if (!conversationId || typeof conversationId !== 'string') {
    return NextResponse.json({ error: 'conversation_id is required' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const { data: conversation, error: fetchError } = await supabase
    .from('conversations')
    .select('id, site_id')
    .eq('id', conversationId)
    .maybeSingle();

  if (fetchError || !conversation) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404, headers: getBuildInfoHeaders() });
  }

  const access = await validateSiteAccess(conversation.site_id, user.id, supabase);
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: getBuildInfoHeaders() });
  }

  const entityType = body.entity_type;
  if (!entityType || !ALLOWED_ENTITY_TYPES.includes(entityType)) {
    return NextResponse.json(
      { error: 'entity_type must be one of: session, call, event' },
      { status: 400, headers: getBuildInfoHeaders() }
    );
  }

  const entityId = body.entity_id;
  if (!entityId || typeof entityId !== 'string') {
    return NextResponse.json({ error: 'entity_id is required' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const siteId = conversation.site_id;
  let entityExists = false;
  if (entityType === 'call') {
    const { data: row } = await supabase
      .from('calls')
      .select('id')
      .eq('id', entityId)
      .eq('site_id', siteId)
      .maybeSingle();
    entityExists = !!row;
  } else if (entityType === 'session') {
    const { data: row } = await supabase
      .from('sessions')
      .select('id')
      .eq('id', entityId)
      .eq('site_id', siteId)
      .maybeSingle();
    entityExists = !!row;
  } else if (entityType === 'event') {
    const { data: row } = await supabase
      .from('events')
      .select('id')
      .eq('id', entityId)
      .eq('site_id', siteId)
      .maybeSingle();
    entityExists = !!row;
  }
  if (!entityExists) {
    return NextResponse.json(
      { error: 'Entity not found or does not belong to this conversation\'s site', code: 'ENTITY_SITE_MISMATCH' },
      { status: 400, headers: getBuildInfoHeaders() }
    );
  }

  const { error: insertError } = await supabase
    .from('conversation_links')
    .insert({ conversation_id: conversationId, entity_type: entityType, entity_id: entityId })
    .select('id')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ success: true, message: 'Link already exists' }, { status: 200, headers: getBuildInfoHeaders() });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500, headers: getBuildInfoHeaders() });
  }

  return NextResponse.json({ success: true }, { status: 201, headers: getBuildInfoHeaders() });
}
