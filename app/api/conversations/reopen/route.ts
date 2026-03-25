import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { isValidUuid, mapConversationRpcError } from '@/lib/api/conversations/http';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: getBuildInfoHeaders() });
  }

  let body: { conversation_id?: string; stage?: string | null; next_follow_up_at?: string | null; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  if (!isValidUuid(body.conversation_id)) {
    return NextResponse.json({ error: 'conversation_id is required and must be a valid UUID' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const stage = body.stage != null && String(body.stage).trim() !== '' ? String(body.stage) : 'follow_up_waiting';
  const nextFollowUpAt = body.next_follow_up_at == null || body.next_follow_up_at === ''
    ? null
    : new Date(body.next_follow_up_at);
  if (nextFollowUpAt && Number.isNaN(nextFollowUpAt.getTime())) {
    return NextResponse.json({ error: 'next_follow_up_at must be a valid ISO date string when provided' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const note = body.note != null ? String(body.note).slice(0, 2000) : null;

  const { data, error } = await supabase.rpc('conversation_reopen_v1', {
    p_conversation_id: body.conversation_id,
    p_stage: stage,
    p_next_follow_up_at: nextFollowUpAt ? nextFollowUpAt.toISOString() : null,
    p_note: note,
  });

  if (error) {
    return mapConversationRpcError(error, 'Failed to reopen conversation');
  }

  return NextResponse.json(data, { status: 200, headers: getBuildInfoHeaders() });
}
