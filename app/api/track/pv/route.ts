/**
 * POST /api/track/pv — V1_PAGEVIEW (MizanMantik 5-Gear)
 *
 * Şok cihazı — volume sinyali, value=0. Orchestrator routes to Redis.
 * Strict GCLID gate: organic traffic silently dropped.
 *
 * Body: { siteId: string, gclid?: string, wbraid?: string, gbraid?: string }
 * Response: 200 OK always (pixel fire-and-forget)
 */

import { NextRequest, NextResponse } from 'next/server';
import { evaluateAndRouteSignal } from '@/lib/domain/mizan-mantik';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { getIngestCorsHeaders } from '@/lib/security/cors';
import { logError } from '@/lib/logging/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

    const now = new Date();
    const result = await evaluateAndRouteSignal('V1_PAGEVIEW', {
      siteId,
      gclid: gclid || null,
      wbraid: wbraid || null,
      gbraid: gbraid || null,
      aov: 0,
      clickDate: now,
      signalDate: now,
    });

    if (!result.routed || !result.pvId) {
      return NextResponse.json({ ok: false }, { status: 200, headers: corsHeaders });
    }

    return NextResponse.json({ ok: true, id: result.pvId }, { status: 200, headers: corsHeaders });
  } catch (e) {
    logError('TRACK_PV_ERROR', { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false }, { status: 200, headers: corsHeaders });
  }
}
