/**
 * POST /api/conversations/resolve — set status WON | LOST | JUNK and optionally attach sale_id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { getBuildInfoHeaders } from '@/lib/build-info';

export const runtime = 'nodejs';

const RESOLVE_STATUSES = ['WON', 'LOST', 'JUNK'];

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: getBuildInfoHeaders() });
  }

  let body: { conversation_id?: string; status?: string; sale_id?: string; note?: string };
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
    .select('id, site_id, status')
    .eq('id', conversationId)
    .maybeSingle();

  if (fetchError || !conversation) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404, headers: getBuildInfoHeaders() });
  }

  const access = await validateSiteAccess(conversation.site_id, user.id, supabase);
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: getBuildInfoHeaders() });
  }

  const status = body.status;
  if (!status || !RESOLVE_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${RESOLVE_STATUSES.join(', ')}` },
      { status: 400, headers: getBuildInfoHeaders() }
    );
  }

  const note = body.note != null ? String(body.note) : null;
  const saleId = body.sale_id != null ? String(body.sale_id) : null;

  const { data: updated, error: updateError } = await supabase
    .from('conversations')
    .update({ status, note: note ?? undefined })
    .eq('id', conversationId)
    .select('id, site_id, status, note, primary_call_id, primary_session_id, primary_source, created_at, updated_at')
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500, headers: getBuildInfoHeaders() });
  }

  if (saleId) {
    const { data: sale } = await supabase
      .from('sales')
      .select('id, conversation_id, status')
      .eq('id', saleId)
      .eq('site_id', conversation.site_id)
      .maybeSingle();

    if (sale && sale.conversation_id == null) {
      await supabase
        .from('sales')
        .update({ conversation_id: conversationId })
        .eq('id', saleId);
      if (sale.status === 'CONFIRMED') {
        const { error: rpcError } = await supabase.rpc('update_offline_conversion_queue_attribution', {
          p_sale_id: saleId,
        });
        if (rpcError?.message?.includes('immutable_after_sent')) {
          return NextResponse.json(
            {
              ...updated,
              error: 'Queue attribution cannot be updated after job was sent',
              code: 'IMMUTABLE_AFTER_SENT',
            },
            { status: 409, headers: getBuildInfoHeaders() }
          );
        }
      }
    }
  }

  return NextResponse.json(updated, { status: 200, headers: getBuildInfoHeaders() });
}
