/**
 * POST /api/track/pv — Lightning Page View ingestion (Ops_PageView)
 *
 * MizanMantik Signal Matrix, 4th Valve: high-volume "Defibrillator" signal for Google Ads.
 * Redis-backed, zero PostgreSQL footprint. Strict GCLID gate: organic traffic is silently dropped.
 *
 * Body: { siteId: string, gclid?: string, wbraid?: string, gbraid?: string }
 * Response: 200 OK always (pixel fire-and-forget)
 */

import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/upstash';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { getIngestCorsHeaders } from '@/lib/security/cors';
import { logError } from '@/lib/logging/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PV_TTL_SEC = 48 * 60 * 60; // 48 hours

function generatePvId(): string {
  return 'pv_' + crypto.randomUUID().replace(/-/g, '');
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = getIngestCorsHeaders(origin, {});
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const corsHeaders = getIngestCorsHeaders(origin, {});

  try {
    const body = await req.json().catch(() => ({}));
    const siteId = typeof body.siteId === 'string' ? body.siteId.trim() : '';
    const gclid = typeof body.gclid === 'string' ? body.gclid.trim() : '';
    const wbraid = typeof body.wbraid === 'string' ? body.wbraid.trim() : '';
    const gbraid = typeof body.gbraid === 'string' ? body.gbraid.trim() : '';

    // GCLID gate: reject organic traffic (no click ID)
    const hasClickId = gclid || wbraid || gbraid;
    if (!hasClickId) {
      return NextResponse.json({ ok: true }, { status: 200, headers: corsHeaders });
    }

    if (!siteId) {
      return NextResponse.json({ ok: true }, { status: 200, headers: corsHeaders });
    }

    const clientId = RateLimitService.getClientId(req);
    await RateLimitService.checkWithMode(clientId, 2000, 60 * 1000, {
      mode: 'fail-closed',
      namespace: 'track-pv',
    });

    const pvId = generatePvId();
    const payload = {
      siteId,
      gclid: gclid || '',
      wbraid: wbraid || '',
      gbraid: gbraid || '',
      timestamp: new Date().toISOString(),
    };

    await redis.set(`pv:data:${pvId}`, JSON.stringify(payload), { ex: PV_TTL_SEC });
    await redis.lpush(`pv:queue:${siteId}`, pvId);

    return NextResponse.json({ ok: true, id: pvId }, { status: 200, headers: corsHeaders });
  } catch (e) {
    logError('TRACK_PV_ERROR', { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false }, { status: 200, headers: corsHeaders });
  }
}
