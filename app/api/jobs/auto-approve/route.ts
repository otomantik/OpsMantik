/**
 * Auto-approve (Auto-Seal) job: marks low-risk stale intents as confirmed after 24h.
 *
 * Scheduling: This endpoint is NOT invoked by any built-in cron. To run daily:
 * - Vercel Cron: Add to vercel.json "crons" and call POST with body { siteId } per site (or
 *   implement a separate route that lists sites and calls this for each).
 * - External cron (e.g. cron-job.org): POST to /api/jobs/auto-approve with Authorization
 *   (or use a server-side script with service role) and body { siteId, minAgeHours?, limit? }.
 * - See docs/OPS/AUTO_APPROVE_CRON.md for full scheduling options.
 *
 * Behaviour: Only low-risk intents are updated (GCLID + session duration >= 10s + events >= 2).
 * Nothing is ever set to junk; uncertain leads stay pending.
 */
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
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: 'Internal server error', details },
      { status: 500 }
    );
  }
}

