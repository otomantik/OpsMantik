/**
 * Client IP resolution for multi-tenant / proxy environments (e.g. SST).
 * When behind a proxy, we MUST trust forwarding headers so the real client IP
 * (e.g. Istanbul) is used, not the proxy/edge IP (e.g. Rome/Amsterdam).
 *
 * Priority: X-Forwarded-For (first) > X-Real-IP > CF-Connecting-IP > True-Client-IP.
 * No client IP in request payload — server resolves from headers only.
 */

import type { NextRequest } from 'next/server';

function getHeader(req: NextRequest | Request, name: string): string | null {
  return req.headers.get(name);
}

/**
 * Returns the real client IP from request headers.
 * Use for ingest IP storage and any IP-based logic (rate limit, geo).
 *
 * @param req - NextRequest or Request (e.g. from route handler)
 * @returns Client IP string or null if none present (caller should use normalizeIp for storage)
 */
export function getClientIp(req: NextRequest | Request): string | null {
  const xff = getHeader(req, 'x-forwarded-for');
  const first = xff ? xff.split(',')[0]?.trim() : null;
  if (first) return first;

  const xri = getHeader(req, 'x-real-ip');
  if (xri?.trim()) return xri.trim();

  const cf = getHeader(req, 'cf-connecting-ip');
  if (cf?.trim()) return cf.trim();

  const tci = getHeader(req, 'true-client-ip');
  if (tci?.trim()) return tci.trim();

  return null;
}
