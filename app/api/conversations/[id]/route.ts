import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { isValidUuid, mapConversationRpcError } from '@/lib/api/conversations/http';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: getBuildInfoHeaders() });
  }

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'conversation id must be a valid UUID' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const { data, error } = await supabase.rpc('get_conversation_detail_v1', {
    p_conversation_id: id,
  });

  if (error) {
    return mapConversationRpcError(error, 'Failed to load conversation detail');
  }

  return NextResponse.json(data, { status: 200, headers: getBuildInfoHeaders() });
}
