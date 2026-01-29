import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * Dev-only endpoint: inserts a synthetic row to trigger realtime.
 * Used for smoke/Playwright proofs.
 *
 * Guardrails:
 * - disabled in production
 * - requires an authenticated user session (cookie-based)
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const siteId = body?.siteId as string | undefined;
  const kind = (body?.kind as string | undefined) || 'calls';

  if (!siteId) {
    return NextResponse.json({ error: 'Missing siteId' }, { status: 400 });
  }

  if (kind === 'sessions') {
    const id = crypto.randomUUID();
    const now = new Date();
    const createdMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);

    const { error } = await adminClient.from('sessions').insert({
      id,
      site_id: siteId,
      created_month: createdMonth,
      created_at: now.toISOString(),
      entry_page: '/',
      event_count: 1,
      total_duration_sec: 1,
      attribution_source: 'debug',
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, kind: 'sessions', id });
  }

  // Default: calls INSERT (site-scoped, reliably triggers realtime channel filters)
  const phone = `+900000${Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, '0')}`;

  const { data, error } = await adminClient
    .from('calls')
    .insert({
      site_id: siteId,
      phone_number: phone,
      source: 'click',
      status: 'intent',
      intent_action: 'phone',
      intent_target: phone,
      intent_stamp: crypto.randomUUID(),
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, kind: 'calls', id: data?.id });
}

