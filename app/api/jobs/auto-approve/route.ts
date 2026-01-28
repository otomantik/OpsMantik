import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';

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
    const minAgeHours = Number(body?.minAgeHours ?? 24);
    const limit = Number(body?.limit ?? 200);

    if (!siteId) {
      return NextResponse.json({ error: 'Missing siteId' }, { status: 400 });
    }

    // RLS-based access check (owner/member/admin)
    const { data: site, error: siteError } = await supabase
      .from('sites')
      .select('id')
      .eq('id', siteId)
      .maybeSingle();

    if (siteError || !site) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { data: updated, error: rpcError } = await adminClient.rpc('auto_approve_stale_intents_v1', {
      p_site_id: siteId,
      p_min_age_hours: Number.isFinite(minAgeHours) ? minAgeHours : 24,
      p_limit: Number.isFinite(limit) ? limit : 200,
    });

    if (rpcError) {
      return NextResponse.json(
        { error: 'Auto-approve failed', details: rpcError.message },
        { status: 500 }
      );
    }

    const count = Array.isArray(updated) ? updated.length : 0;

    return NextResponse.json({ ok: true, updated: count });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Internal server error', details: e?.message || String(e) },
      { status: 500 }
    );
  }
}

