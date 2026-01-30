/**
 * Watchtower GO W1 — Request ID for all API requests.
 * Generates x-request-id (crypto.randomUUID()), adds to request and response.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', requestId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set('x-request-id', requestId);
  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
