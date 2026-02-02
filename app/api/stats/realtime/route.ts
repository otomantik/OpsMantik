import { NextRequest, NextResponse } from 'next/server';
import { StatsService } from '@/lib/services/stats-service';
import { isOriginAllowed, parseAllowedOrigins } from '@/lib/cors';

export const runtime = 'nodejs';

const ALLOWED_ORIGINS = parseAllowedOrigins();

export async function GET(req: NextRequest) {
    // Same-origin browser fetches may omit the Origin header for GET requests.
    // In that case, fall back to Referer → URL origin → nextUrl.origin.
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
    const siteId = searchParams.get('siteId');

    if (!siteId) {
        return NextResponse.json({ error: 'siteId required' }, { status: 400 });
    }

    try {
        const stats = await StatsService.getRealtimeStats(siteId);
        return NextResponse.json(stats);
    } catch (error) {
        console.error('[STATS_REALTIME] Redis error:', error);
        // Fallback so dashboard does not break when Redis is down or env missing
        return NextResponse.json({ captured: 0, gclid: 0, junk: 0, _fallback: true });
    }
}
