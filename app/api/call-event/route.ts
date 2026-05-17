import { NextRequest, NextResponse } from 'next/server';
import { getIngestCorsHeaders } from '@/lib/security/cors';
import { getRefactorFlags } from '@/lib/refactor/flags';
import { POST as postCallEventV2 } from '@/app/api/call-event/v2/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPSMANTIK_VERSION = '1.0.2-sunset';
const CALL_EVENT_V2_ROUTE = '/api/call-event/v2';
const DEPRECATION_SUNSET = '2026-05-10';

function deprecationHeaders(origin: string | null): Record<string, string> {
  return getIngestCorsHeaders(origin, {
    'X-OpsMantik-Version': OPSMANTIK_VERSION,
    'X-Ops-Deprecated': '1',
    'X-Ops-Deprecated-Use': CALL_EVENT_V2_ROUTE,
    Sunset: DEPRECATION_SUNSET,
  });
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = deprecationHeaders(origin);
  const res = new NextResponse(null, { status: 200, headers });
  if (origin) res.headers.set('Access-Control-Allow-Credentials', 'true');
  return res;
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const baseHeaders = deprecationHeaders(origin);

  if (!getRefactorFlags().legacy_endpoints_enabled) {
    return NextResponse.json(
      {
        error: 'gone',
        canonical: CALL_EVENT_V2_ROUTE,
        message: 'Use POST /api/call-event/v2',
      },
      { status: 410, headers: baseHeaders }
    );
  }

  return postCallEventV2(req);
}
