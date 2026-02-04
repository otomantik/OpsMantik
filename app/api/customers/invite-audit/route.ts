import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const siteId = String(body?.siteId || '');
    const limit = Number(body?.limit ?? 50);
    const offset = Number(body?.offset ?? 0);
    const emailQuery = typeof body?.emailQuery === 'string' ? body.emailQuery : null;
    const outcome = typeof body?.outcome === 'string' ? body.outcome : null;

    if (!siteId) {
      return NextResponse.json({ error: 'Missing siteId' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('get_customer_invite_audit_v1', {
      p_site_id: siteId,
      p_limit: Number.isFinite(limit) ? limit : 50,
      p_offset: Number.isFinite(offset) ? offset : 0,
      p_email_query: emailQuery,
      p_outcome: outcome,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, audit: data });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}

