import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth/is-admin';
import { adminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { qstash } from '@/lib/qstash/client';

export const runtime = 'nodejs';

async function getCurrentUserForAudit(): Promise<{ id: string | null; email: string | null }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return { id: user?.id ?? null, email: user?.email ?? null };
  } catch {
    return { id: null, email: null };
  }
}

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

  const auditUser = await getCurrentUserForAudit();

  try {
    const { data: row, error } = await adminClient
      .from('sync_dlq')
      .select('id, payload')
      .eq('id', dlqId)
      .single();

    if (error) throw error;

    const workerUrl = `${new URL(req.url).origin}/api/workers/ingest`;
    await qstash.publishJSON({
      url: workerUrl,
      body: row.payload,
      retries: 3,
    });

    const { data: updated, error: rpcErr } = await adminClient
      .rpc('sync_dlq_record_replay', { p_id: dlqId, p_error: null });

    if (rpcErr) throw rpcErr;

    const meta = Array.isArray(updated) ? updated[0] : updated;
    const replayCountAfter = meta?.replay_count ?? 0;

    await adminClient.from('sync_dlq_replay_audit').insert({
      dlq_id: dlqId,
      replayed_by_user_id: auditUser.id,
      replayed_by_email: auditUser.email,
      replay_count_after: replayCountAfter,
      error_if_failed: null,
    });

    return NextResponse.json({ ok: true, id: dlqId, replay_count: replayCountAfter });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      await adminClient.rpc('sync_dlq_record_replay', { p_id: dlqId, p_error: message });
    } catch { /* ignore */ }

    try {
      const { data: row } = await adminClient.from('sync_dlq').select('replay_count').eq('id', dlqId).single();
      const replayCountAfter = Number(row?.replay_count ?? 0);
      await adminClient.from('sync_dlq_replay_audit').insert({
        dlq_id: dlqId,
        replayed_by_user_id: auditUser.id,
        replayed_by_email: auditUser.email,
        replay_count_after: replayCountAfter,
        error_if_failed: message,
      });
    } catch { /* ignore */ }

    return NextResponse.json({ error: 'replay_failed', message }, { status: 500 });
  }
}

