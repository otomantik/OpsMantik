/**
 * GET /api/sites/[siteId]/calls/by-phone
 * Query: phone (E.164, e.g. +905321234567 or 905321234567)
 *
 * Returns intent/call summary for Probe HUD when phone is ringing.
 * Auth: Bearer (Supabase) + validateSiteAccess.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { normalizeToE164 } from '@/lib/dic/e164';

export const dynamic = 'force-dynamic';

function digitsOnly(s: string): string {
  return (s || '').replace(/\D/g, '');
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { siteId } = await params;
    const phoneRaw = req.nextUrl.searchParams.get('phone')?.trim() || '';
    if (!siteId || !phoneRaw) {
      return NextResponse.json(
        { error: 'Missing siteId or phone query parameter' },
        { status: 400 }
      );
    }

    // Resolve site_id to UUID (accepts public_id or UUID)
    const { valid, site } = await import('@/lib/services/site-service').then((m) => m.SiteService.validateSite(siteId));
    if (!valid || !site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    const siteUuid = site.id;

    const access = await validateSiteAccess(siteUuid, user.id, supabase);
    if (!access.allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Normalize to E.164 digits (no +) for DB comparison
    const e164 = normalizeToE164(phoneRaw.startsWith('+') ? phoneRaw : `+${phoneRaw}`, 'TR') || digitsOnly(phoneRaw);
    if (!e164 || e164.length < 10) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }
    const digits = digitsOnly(e164);

    // Find most recent call for this site where phone matches (intent_target, caller_phone_e164, or phone_number)
    const { data: calls } = await adminClient
      .from('calls')
      .select(`
        id,
        created_at,
        intent_action,
        intent_target,
        phone_number,
        caller_phone_e164,
        lead_score,
        status,
        matched_session_id
      `)
      .eq('site_id', siteUuid)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!calls || calls.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const match = calls.find((c) => {
      const it = digitsOnly((c.intent_target as string) || '');
      const cp = digitsOnly((c.caller_phone_e164 as string) || '');
      const pn = digitsOnly((c.phone_number as string) || '');
      return it === digits || cp === digits || pn === digits;
    });

    if (!match) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const callId = match.id as string;

    // Optional: get projection for highest_stage and value
    const { data: proj } = await adminClient
      .from('call_funnel_projection')
      .select('highest_stage, offered_at, won_at, quality_score')
      .eq('call_id', callId)
      .maybeSingle();

    const highestStage = proj?.highest_stage ?? 'junk';
    const stageLabel =
      highestStage === 'won'
        ? 'Won - Sealed'
        : highestStage === 'offered'
          ? 'Offered - Hot Intent'
          : highestStage === 'contacted'
            ? 'Contacted - Qualified Lead'
            : 'Known Caller - Unqualified / Junk';

    // Merchant insight: from session if available
    let merchantInsight: string | null = null;
    let predictedLtv: number | null = null;
    if (match.matched_session_id) {
      const { data: session } = await adminClient
        .from('sessions')
        .select('entry_page, total_duration_sec, utm_campaign, utm_term')
        .eq('id', match.matched_session_id)
        .maybeSingle();
      if (session) {
        const page = (session.entry_page as string) || '';
        const sec = typeof session.total_duration_sec === 'number' ? session.total_duration_sec : 0;
        const camp = (session.utm_campaign as string) || '';
        const term = (session.utm_term as string) || '';
        const parts: string[] = [];
        if (sec > 0) parts.push(`Spent ${Math.round(sec / 60)} mins`);
        if (page) parts.push(`on '${page.replace(/^https?:\/\/[^/]+/, '').slice(0, 40)}'`);
        if (camp || term) parts.push(`(${camp || ''} ${term || ''})`.trim());
        merchantInsight = parts.length > 0 ? parts.join(' ') : null;
      }
    }
    if (proj?.quality_score != null && typeof proj.quality_score === 'number') {
      // Rough LTV hint from quality (1-5) * 100 as placeholder if no value
      predictedLtv = proj.quality_score * 100;
    }

    return NextResponse.json({
      callId,
      highestStage: stageLabel,
      merchantInsight,
      predictedLtv,
      lastContact: (match.created_at as string) || new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to lookup by phone' },
      { status: 500 }
    );
  }
}
