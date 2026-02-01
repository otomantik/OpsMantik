import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth/isAdmin';
import { adminClient } from '@/lib/supabase/admin';
import { Client } from '@upstash/qstash';

export const runtime = 'nodejs';

const qstash = new Client({ token: process.env.QSTASH_TOKEN || '' });

export async function POST(req: NextRequest) {
  const admin = await isAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const dlqId = searchParams.get('id');
  if (!dlqId) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  try {
    const { data: row, error } = await adminClient
      .from('sync_dlq')
      .select('id, payload')
      .eq('id', dlqId)
      .single();

    if (error) throw error;

    const workerUrl = `${new URL(req.url).origin}/api/sync/worker`;
    await qstash.publishJSON({
      url: workerUrl,
      body: row.payload,
      retries: 3,
    });

    const { data: updated, error: rpcErr } = await adminClient
      .rpc('sync_dlq_record_replay', { p_id: dlqId, p_error: null });

    if (rpcErr) throw rpcErr;

    const meta = Array.isArray(updated) ? updated[0] : updated;
    return NextResponse.json({ ok: true, id: dlqId, replay_count: meta?.replay_count ?? null });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      await adminClient.rpc('sync_dlq_record_replay', { p_id: dlqId, p_error: message });
    } catch { /* ignore */ }

    return NextResponse.json({ error: 'replay_failed', message }, { status: 500 });
  }
}

