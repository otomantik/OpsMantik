import { NextRequest, NextResponse } from 'next/server';
import { StatsService } from '@/lib/services/stats-service';
import { isOriginAllowed, parseAllowedOrigins } from '@/lib/cors';

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
        return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
    }
}
