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
  const siteDbId = searchParams.get('siteDbId'); // optional (uuid)

  let query = adminClient
    .from('sync_dlq')
    .select('id,received_at,site_id,stage,error,qstash_message_id,dedup_event_id,replay_count,last_replay_at,last_replay_error', { count: 'exact' })
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (siteDbId) {
    query = query.eq('site_id', siteDbId);
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: 'list_failed', message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: count ?? null, items: data || [] });
}

