/**
 * Watchtower GO W1 — Request ID for all API requests.
 * Generates x-request-id (crypto.randomUUID()), adds to request and response.
 * 
 * OpsMantik Security — Supabase Auth Middleware
 * Refreshes sessions and protects /dashboard routes.
 */
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  // 1. Generate Request ID
  const requestId = crypto.randomUUID();
  request.headers.set('x-request-id', requestId);

  // 2. Run Supabase Auth Middleware (manages session & protection)
  const response = await updateSession(request);

  // 3. Add Request ID to Response Headers (so client sees it)
  response.headers.set('x-request-id', requestId);

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
