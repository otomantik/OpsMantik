/**
 * POST /api/conversations/resolve — set status WON | LOST | JUNK and optionally attach sale_id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { logError } from '@/lib/logging/logger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

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
  if (!isValidUuid(conversationId)) {
    return NextResponse.json({ error: 'conversation_id is required and must be a valid UUID' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const status = body.status;
  if (!status || !RESOLVE_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${RESOLVE_STATUSES.join(', ')}` },
      { status: 400, headers: getBuildInfoHeaders() }
    );
  }

  const note = body.note != null ? String(body.note).slice(0, 2000) : null;
  const saleId = body.sale_id != null
    ? (isValidUuid(body.sale_id) ? body.sale_id : null)
    : null;
  if (body.sale_id != null && saleId === null) {
    return NextResponse.json({ error: 'sale_id must be a valid UUID' }, { status: 400, headers: getBuildInfoHeaders() });
  }
  const { data, error: resolveError } = await supabase.rpc('resolve_conversation_with_sale_link', {
    p_conversation_id: conversationId,
    p_status: status,
    p_note: note,
    p_sale_id: saleId,
  });

  if (resolveError) {
    if (resolveError.message === 'conversation_not_found') {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404, headers: getBuildInfoHeaders() });
    }
    if (resolveError.message === 'access_denied') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: getBuildInfoHeaders() });
    }
    if (resolveError.message === 'sale_not_found') {
      return NextResponse.json({ error: 'Sale not found' }, { status: 400, headers: getBuildInfoHeaders() });
    }
    if (resolveError.message === 'sale_site_mismatch') {
      return NextResponse.json(
        { error: 'sale_id does not belong to this conversation site', code: 'SALE_SITE_MISMATCH' },
        { status: 400, headers: getBuildInfoHeaders() }
      );
    }
    if (resolveError.message === 'sale_already_linked_elsewhere') {
      return NextResponse.json(
        { error: 'Sale is already linked to another conversation', code: 'SALE_ALREADY_LINKED_ELSEWHERE' },
        { status: 409, headers: getBuildInfoHeaders() }
      );
    }
    if (resolveError.message === 'immutable_after_sent') {
      return NextResponse.json(
        { error: 'Queue attribution cannot be updated after job was sent', code: 'IMMUTABLE_AFTER_SENT' },
        { status: 409, headers: getBuildInfoHeaders() }
      );
    }
    logError('CONVERSATION_RESOLVE_UNEXPECTED_ERROR', { conversation_id: conversationId, error: resolveError.message, code: resolveError.code });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: getBuildInfoHeaders() });
  }

  const updated = Array.isArray(data) ? data[0] : data;
  if (!updated || typeof updated !== 'object') {
    return NextResponse.json({ error: 'Failed to resolve conversation' }, { status: 500, headers: getBuildInfoHeaders() });
  }

  return NextResponse.json(updated, { status: 200, headers: getBuildInfoHeaders() });
}
