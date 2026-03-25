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

  let body: { conversation_id?: string; assigned_to?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  if (!isValidUuid(body.conversation_id)) {
    return NextResponse.json({ error: 'conversation_id is required and must be a valid UUID' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const assignedTo = body.assigned_to == null || body.assigned_to === ''
    ? null
    : (isValidUuid(body.assigned_to) ? body.assigned_to : null);
  if (body.assigned_to != null && body.assigned_to !== '' && assignedTo === null) {
    return NextResponse.json({ error: 'assigned_to must be a valid UUID or null' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const { data, error } = await supabase.rpc('conversation_assign_v1', {
    p_conversation_id: body.conversation_id,
    p_assigned_to: assignedTo,
  });

  if (error) {
    return mapConversationRpcError(error, 'Failed to assign conversation');
  }

  return NextResponse.json(data, { status: 200, headers: getBuildInfoHeaders() });
}
