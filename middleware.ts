/**
 * Watchtower GO W1 — Request ID + OM-TRACE-UUID for all API requests.
 * Phase 20: OM-TRACE-UUID = forensic trace across sync → QStash → worker → DB.
 * Phase 20: Edge rate limiting + Düsseldorf geo-fence for /api/sync (Iron Dome).
 *
 * OpsMantik Security — Supabase Auth Middleware
 * Refreshes sessions and protects /dashboard routes.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export const OM_TRACE_HEADER = 'om-trace-uuid';

/** Phase 20: Düsseldorf geo-fence — block DC/proxy traffic to ingest. */
const DUSSELDORF_CITIES = new Set(['düsseldorf', 'dusseldorf']);
function isDusseldorfGeo(req: NextRequest): boolean {
  const city =
    req.headers.get('cf-ipcity') ||
    req.headers.get('x-vercel-ip-city') ||
    req.headers.get('x-city') ||
    '';
  return DUSSELDORF_CITIES.has(city.trim().toLowerCase());
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Phase 20: Iron Dome — /api/sync only
  if (path === '/api/sync') {
    if (isDusseldorfGeo(request)) {
      return NextResponse.json({ error: 'Forbidden', code: 'GEO_FENCE_DUSSELDORF' }, { status: 403 });
    }
    try {
      const { Ratelimit } = await import('@upstash/ratelimit');
      const { Redis } = await import('@upstash/redis');
      const redis = Redis.fromEnv();
      const ratelimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(3000, '1 m'),
        analytics: true,
      });
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip')?.trim() || '127.0.0.1';
      const { success } = await ratelimit.limit(`sync:${ip}`);
      if (!success) {
        return NextResponse.json(
          { error: 'Too many requests', code: 'RATE_LIMIT' },
          { status: 429, headers: { 'Retry-After': '60' } }
        );
      }
    } catch {
      // Redis/ratelimit unavailable (e.g. CI) — fall through
    }
  }

  // 1. Generate trace UUID (atomic entry for forensic chain)
  const traceId = crypto.randomUUID();
  request.headers.set('x-request-id', traceId);
  request.headers.set(OM_TRACE_HEADER, traceId);

  // 2. Run Supabase Auth Middleware (manages session & protection)
  const response = await updateSession(request);

  // 3. Add headers to response (client + forensic tooling)
  response.headers.set('x-request-id', traceId);
  response.headers.set(OM_TRACE_HEADER, traceId);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - .svg, .png, .jpg (assets)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
