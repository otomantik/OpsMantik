import { NextRequest, NextResponse } from 'next/server';
import { StatsService } from '@/lib/services/stats-service';
import { isOriginAllowed, parseAllowedOrigins } from '@/lib/cors';

export const runtime = 'nodejs';

const ALLOWED_ORIGINS = parseAllowedOrigins();

export async function GET(req: NextRequest) {
    const origin = req.headers.get('origin');
    const { isAllowed } = isOriginAllowed(origin, ALLOWED_ORIGINS);

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
