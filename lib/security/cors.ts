/**
 * CORS Helper - Safe Domain Matching & Fail-Closed Production
 * 
 * Security:
 * - Fail-closed in production (throws if ALLOWED_ORIGINS missing)
 * - Safe domain matching (exact + subdomain only, no substring)
 * - Prevents domain hijacking attacks
 */

/**
 * Parse and validate ALLOWED_ORIGINS environment variable
 * 
 * @returns Array of allowed origins
 */
export function parseAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS;
  const isProduction = process.env.NODE_ENV === 'production';
  // Check if we are in the build phase or CI
  const isBuildTime = process.env.NEXT_PHASE === 'phase-production-build' || process.env.CI === 'true' || process.env.VERCEL === '1';

  // Fail-closed in production, but only at runtime to avoid build-time env injection issues
  if (isProduction && !isBuildTime) {
    if (!raw || raw.trim() === '') {
      console.error('[CORS] CRITICAL Error: ALLOWED_ORIGINS environment variable is missing.');
      throw new Error('[CORS] CRITICAL: ALLOWED_ORIGINS must be set in production');
    }
  }

  // Development or Build-time: allow wildcard/empty defaults to prevent build stalls
  if (!raw || raw.trim() === '') {
    return isProduction ? [] : ['*'];
  }

  // Split by comma, remove ALL whitespace/newlines, filter empty strings
  const origins = raw.split(',')
    .map(o => o.replace(/\s/g, '')) // Remove any whitespace or newlines globally
    .filter(o => o.length > 0);

  if (origins.length === 0) {
    if (isProduction && !isBuildTime) {
      console.error('[CORS] CRITICAL: ALLOWED_ORIGINS is empty after parsing');
      throw new Error('[CORS] CRITICAL: ALLOWED_ORIGINS must contain at least one origin in production');
    }
    return isProduction ? [] : ['*'];
  }

  // Hard-fail if wildcard found in production (at runtime)
  if (isProduction && !isBuildTime && origins.includes('*')) {
    throw new Error('Security Risk: Wildcard CORS is not allowed in production.');
  }

  return origins;
}



/**
 * Check if origin is allowed using safe domain matching
 * 
 * Rules:
 * - Wildcard '*' allows all (security warning handled in parseAllowedOrigins)
 * - Exact full origin match: "https://example.com" === "https://example.com"
 * - Subdomain match: "https://www.example.com" matches allowed "https://example.com"
 * - Protocol + Slash agnostic version
 * 
 * @param origin - Origin header value (e.g., "https://example.com")
 * @param allowedOrigins - Array of allowed origins from parseAllowedOrigins()
 * @returns { isAllowed: boolean, reason?: string }
 */
export function isOriginAllowed(origin: string | null, allowedOrigins: string[]): { isAllowed: boolean, reason?: string } {
  if (!origin) return { isAllowed: false, reason: 'missing_origin' };
  if (allowedOrigins.includes('*')) return { isAllowed: true };

  const normalizedOrigin = origin.toLowerCase().trim().replace(/\/+$/, '');

  for (const allowed of allowedOrigins) {
    const normalizedAllowed = allowed.toLowerCase().trim().replace(/\/+$/, '');

    // 1. Exact match (shorthand or full)
    if (normalizedOrigin === normalizedAllowed) return { isAllowed: true };

    // 2. Protocol-less match fallback
    if (!normalizedAllowed.includes('://')) {
      const originHost = normalizedOrigin.replace(/^https?:\/\//, '').split('/')[0];
      if (originHost === normalizedAllowed || originHost.endsWith('.' + normalizedAllowed)) {
        return { isAllowed: true };
      }
    }

    // 3. Robust URL comparison
    try {
      const oUrl = new URL(normalizedOrigin);
      const aUrl = new URL(normalizedAllowed.includes('://') ? normalizedAllowed : `https://${normalizedAllowed}`);

      // Match if same host or subdomain
      if (oUrl.hostname === aUrl.hostname) return { isAllowed: true };
      if (oUrl.hostname.endsWith('.' + aUrl.hostname)) return { isAllowed: true };
    } catch {
      // Continue to next check
    }
  }

  return {
    isAllowed: false,
    reason: `origin_mismatch: received=${normalizedOrigin}, allowed_count=${allowedOrigins.length}`
  };
}

/**
 * Echo-Origin CORS headers for public ingest routes (/api/sync, /api/call-event).
 * Security: site_id validation in the route handler is the auth boundary.
 * No ALLOWED_ORIGINS check — matches industry standard (GA, GTM, etc).
 *
 * @param origin - Origin header value (or null)
 * @param extraHeaders - Optional extra headers to merge (e.g. X-OpsMantik-Version)
 */
export function getIngestCorsHeaders(
  origin: string | null,
  extraHeaders?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-OpsMantik-Version, X-Ops-Site-Id, X-Ops-Ts, X-Ops-Signature, X-Ops-Proxy, X-Ops-Proxy-Host',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    ...extraHeaders,
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    // When request uses credentials: 'include', browser requires this to be 'true' (and origin cannot be '*').
    headers['Access-Control-Allow-Credentials'] = 'true';
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }
  return headers;
}
