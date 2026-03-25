/**
 * POST /api/conversations/link — add a link (session | call | event) to a conversation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { isValidUuid, mapConversationRpcError } from '@/lib/api/conversations/http';

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
  if (!isValidUuid(conversationId)) {
    return NextResponse.json({ error: 'conversation_id is required and must be a valid UUID' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const entityType = body.entity_type;
  if (!entityType || !ALLOWED_ENTITY_TYPES.includes(entityType)) {
    return NextResponse.json(
      { error: 'entity_type must be one of: session, call, event' },
      { status: 400, headers: getBuildInfoHeaders() }
    );
  }

  const entityId = body.entity_id;
  if (!isValidUuid(entityId)) {
    return NextResponse.json({ error: 'entity_id is required and must be a valid UUID' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const { data, error: insertError } = await supabase.rpc('conversation_link_entity_v1', {
    p_conversation_id: conversationId,
    p_entity_type: entityType,
    p_entity_id: entityId,
  });

  if (insertError) {
    return mapConversationRpcError(insertError, 'Failed to link conversation entity');
  }

  const linked = Boolean((data as { linked?: boolean } | null)?.linked);
  return NextResponse.json(data, { status: linked ? 201 : 200, headers: getBuildInfoHeaders() });
}
