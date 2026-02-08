import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth/is-admin';
import { adminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const admin = await isAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get('limit') || 50), 200);
  const offset = Math.max(Number(searchParams.get('offset') || 0), 0);
  const dlqId = searchParams.get('dlqId');

  let query = adminClient
    .from('sync_dlq_replay_audit')
    .select('id,dlq_id,replayed_by_user_id,replayed_by_email,replayed_at,replay_count_after,error_if_failed', { count: 'exact' })
    .order('replayed_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (dlqId) {
    query = query.eq('dlq_id', dlqId);
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: 'audit_list_failed', message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: count ?? null, items: data || [] });
}
