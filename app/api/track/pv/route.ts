/**
 * POST /api/track/pv — DEPRECATED (410 Gone)
 *
 * This endpoint was part of the deleted 5-Gear (V1_PAGEVIEW) architecture. It was broken end-to-end:
 *   - evaluateAndRouteSignal('junk', ...) without callId always pre_route_rejects.
 *   - The 'junk' stage is explicitly dropped by the canonical stage router.
 *   - result.pvId is never set by the orchestrator (no Redis PV writer exists).
 *
 * The endpoint is preserved as 410 Gone so any legacy tracker code fails loudly instead of
 * silently writing no data. Page-view pipelines should go through the canonical /api/sync path
 * (call events and session telemetry) going forward.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getIngestCorsHeaders } from '@/lib/security/cors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GONE_BODY = {
  ok: false,
  error: 'endpoint_removed',
  message: '/api/track/pv has been removed. Use /api/sync for telemetry ingestion.',
} as const;

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = getIngestCorsHeaders(origin, {});
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const corsHeaders = getIngestCorsHeaders(origin, {});
  return NextResponse.json(GONE_BODY, { status: 410, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const corsHeaders = getIngestCorsHeaders(origin, {});
  return NextResponse.json(GONE_BODY, { status: 410, headers: corsHeaders });
}
