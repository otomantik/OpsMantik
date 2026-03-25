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

  let body: { conversation_id?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  if (!isValidUuid(body.conversation_id)) {
    return NextResponse.json({ error: 'conversation_id is required and must be a valid UUID' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const note = body.note != null ? String(body.note).slice(0, 2000) : '';
  if (!note.trim()) {
    return NextResponse.json({ error: 'note is required' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const { data, error } = await supabase.rpc('conversation_add_note_v1', {
    p_conversation_id: body.conversation_id,
    p_note: note,
  });

  if (error) {
    return mapConversationRpcError(error, 'Failed to add conversation note');
  }

  return NextResponse.json(data, { status: 200, headers: getBuildInfoHeaders() });
}
