/**
 * Edge Precision Logic: Real Client IP Resolution + Bot/Proxy Tagging
 *
 * Use this INSTEAD of raw 'ip' object or Vercel's geo. Vercel/Cloudflare edge
 * can return edge server IP (Düsseldorf/Frankfurt) instead of real client.
 *
 * Priority: cf-connecting-ip > x-real-ip > x-forwarded-for (first)
 * When geo city is ghost (Düsseldorf/Frankfurt) AND UA is bot → tag EDGE_PROXY/SYSTEM_BOT
 *
 * Edge Runtime compatible. Import in sync/call-event routes and ingest workers.
 */

import type { NextRequest } from 'next/server';

/** Cities that indicate edge/proxy IP geo, not real user location */
const EDGE_GHOST_CITIES = new Set([
  'düsseldorf',
  'dusseldorf',
  'frankfurt',
  'ashburn',
  'rome',
  'amsterdam',
  'roma',
  'london',
]);

/** User-Agent substrings that indicate system bots (not real users) */
const BOT_UA_PATTERNS = ['AdsBot', 'Googlebot', 'Mediapartners-Google', 'Google-InspectionTool'];

export type EdgeClientResult = {
  /** Resolved client IP (real user when behind proxy) */
  ip: string | null;
  /** When true: ghost city + bot UA → treat as EDGE_PROXY/SYSTEM_BOT, skip geo write */
  isEdgeProxyOrBot: boolean;
  /** Tag for downstream: 'REAL_CLIENT' | 'EDGE_PROXY' | 'SYSTEM_BOT' */
  tag: 'REAL_CLIENT' | 'EDGE_PROXY' | 'SYSTEM_BOT';
};

function getHeader(req: NextRequest | Request, name: string): string | null {
  return req.headers.get(name);
}

/**
 * Returns real client IP from headers.
 * Priority: cf-connecting-ip > x-real-ip > x-forwarded-for (first)
 *
 * Rationale: cf-connecting-ip is Cloudflare's canonical "originating client IP".
 * When behind Cloudflare, x-forwarded-for may be spoofed; cf-connecting-ip is trusted.
 * Vercel sets x-real-ip from the last proxy; x-forwarded-for first = original client.
 */
export function resolveClientIp(req: NextRequest | Request): string | null {
  const cf = getHeader(req, 'cf-connecting-ip');
  if (cf?.trim()) return cf.trim();

  const xri = getHeader(req, 'x-real-ip');
  if (xri?.trim()) return xri.trim();

  const xff = getHeader(req, 'x-forwarded-for');
  const first = xff ? xff.split(',')[0]?.trim() : null;
  if (first) return first;

  return null;
}

function isBotUserAgent(ua: string): boolean {
  const uaLower = ua.toLowerCase();
  return BOT_UA_PATTERNS.some((p) => uaLower.includes(p.toLowerCase()));
}

function isGhostCity(city: string | null): boolean {
  if (!city || typeof city !== 'string') return false;
  return EDGE_GHOST_CITIES.has(city.trim().toLowerCase());
}

/**
 * Full edge validation: IP + bot/proxy tagging.
 * Use before writing geo to DB. When isEdgeProxyOrBot=true, caller should:
 * - Not store IP-derived geo
 * - Tag session/event as EDGE_PROXY or SYSTEM_BOT
 *
 * @param req - NextRequest or Request
 * @param options - Optional geo city from headers (cf-ipcity, x-vercel-ip-city)
 */
export function resolveEdgeClient(
  req: NextRequest | Request,
  options?: { geoCity?: string | null }
): EdgeClientResult {
  const ip = resolveClientIp(req);
  const ua = getHeader(req, 'user-agent') ?? '';
  const city = options?.geoCity ?? getHeader(req, 'cf-ipcity') ?? getHeader(req, 'x-vercel-ip-city') ?? null;

  const ghostCity = isGhostCity(city);
  const botUa = isBotUserAgent(ua);

  if (ghostCity && botUa) {
    return {
      ip: ip ?? null,
      isEdgeProxyOrBot: true,
      tag: 'SYSTEM_BOT',
    };
  }

  if (ghostCity) {
    return {
      ip: ip ?? null,
      isEdgeProxyOrBot: true,
      tag: 'EDGE_PROXY',
    };
  }

  return {
    ip: ip ?? null,
    isEdgeProxyOrBot: false,
    tag: 'REAL_CLIENT',
  };
}
