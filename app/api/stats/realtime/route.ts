import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { StatsService } from '@/lib/services/stats-service';
import { isOriginAllowed, parseAllowedOrigins } from '@/lib/cors';
import { validateSiteAccess } from '@/lib/security/validate-site-access';

export const runtime = 'nodejs';

const ALLOWED_ORIGINS = parseAllowedOrigins();

/**
 * GET /api/stats/realtime?siteId=<uuid|public_id>
 * Returns Redis overlay stats (captured, gclid, junk) for today.
 * Security: requires auth + site access (IDOR fix). siteId can be site UUID or public_id.
 */
export async function GET(req: NextRequest) {
    // Same-origin browser fetches may omit the Origin header for GET requests.
    const originHeader = req.headers.get('origin');
    const referer = req.headers.get('referer');
    let originToCheck: string | null = originHeader;
    if (!originToCheck && referer) {
        try {
            originToCheck = new URL(referer).origin;
        } catch {
            // ignore invalid referer
        }
    }
    if (!originToCheck) {
        originToCheck = req.nextUrl.origin;
    }
    const { isAllowed } = isOriginAllowed(originToCheck, ALLOWED_ORIGINS);
    if (!isAllowed) {
        return new NextResponse(null, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const siteIdParam = searchParams.get('siteId');
    if (!siteIdParam) {
        return NextResponse.json({ error: 'siteId required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Resolve siteId (UUID or public_id) to site UUID and get public_id for Redis key (no string concat in filter)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(siteIdParam);
    let site: { id: string; public_id: string | null } | null = null;
    if (isUuid) {
        const r = await supabase.from('sites').select('id, public_id').eq('id', siteIdParam).maybeSingle();
        site = r.data;
    }
    if (!site) {
        const r = await supabase.from('sites').select('id, public_id').eq('public_id', siteIdParam).maybeSingle();
        site = r.data;
    }
    if (!site) {
        return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const access = await validateSiteAccess(site.id, user.id, supabase);
    if (!access.allowed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const redisKeyId = site.public_id || site.id;
    const timezoneHeader = req.headers.get('x-timezone');
    const timezone = typeof timezoneHeader === 'string' && timezoneHeader.trim().length > 0
        ? timezoneHeader.trim()
        : undefined;
    try {
        const stats = await StatsService.getRealtimeStats(redisKeyId, undefined, timezone);
        return NextResponse.json(stats);
    } catch (error) {
        console.error('[STATS_REALTIME] Redis error:', error);
        return NextResponse.json({ captured: 0, gclid: 0, junk: 0, _fallback: true });
    }
}
