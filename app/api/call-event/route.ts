import { NextRequest, NextResponse } from 'next/server';
import { getIngestCorsHeaders } from '@/lib/security/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CALL_EVENT_V2_ROUTE = '/api/call-event/v2';
const DEPRECATION_SUNSET = '2026-05-10';

function deprecationHeaders(origin: string | null): Record<string, string> {
  return getIngestCorsHeaders(origin, {
    'X-OpsMantik-Version': '1.0.2-removed',
    'X-Ops-Deprecated': '1',
    'X-Ops-Deprecated-Use': CALL_EVENT_V2_ROUTE,
    Sunset: DEPRECATION_SUNSET,
  });
}

function goneResponse(origin: string | null): NextResponse {
  return NextResponse.json(
    {
      error: 'gone',
      canonical: CALL_EVENT_V2_ROUTE,
      message: 'Use POST /api/call-event/v2',
    },
    { status: 410, headers: deprecationHeaders(origin) }
  );
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = deprecationHeaders(origin);
  const res = new NextResponse(null, { status: 200, headers });
  if (origin) res.headers.set('Access-Control-Allow-Credentials', 'true');
  return res;
}

/** Tombstone: v1 ingest removed; canonical path is /api/call-event/v2 only. */
export async function POST(req: NextRequest) {
  return goneResponse(req.headers.get('origin'));
}
