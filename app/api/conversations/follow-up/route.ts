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

  let body: { conversation_id?: string; next_follow_up_at?: string; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  if (!isValidUuid(body.conversation_id)) {
    return NextResponse.json({ error: 'conversation_id is required and must be a valid UUID' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const nextFollowUpAt = body.next_follow_up_at ? new Date(body.next_follow_up_at) : null;
  if (!nextFollowUpAt || Number.isNaN(nextFollowUpAt.getTime())) {
    return NextResponse.json({ error: 'next_follow_up_at is required and must be a valid ISO date string' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const note = body.note != null ? String(body.note).slice(0, 2000) : null;

  const { data, error } = await supabase.rpc('conversation_set_follow_up_v1', {
    p_conversation_id: body.conversation_id,
    p_next_follow_up_at: nextFollowUpAt.toISOString(),
    p_note: note,
  });

  if (error) {
    return mapConversationRpcError(error, 'Failed to set conversation follow-up');
  }

  return NextResponse.json(data, { status: 200, headers: getBuildInfoHeaders() });
}
