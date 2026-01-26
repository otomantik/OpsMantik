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
 * @throws Error in production if ALLOWED_ORIGINS is missing/empty
 */
export function parseAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS;
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

  // Fail-closed in production
  if (isProduction) {
    if (!raw || raw.trim() === '') {
      throw new Error('[CORS] CRITICAL: ALLOWED_ORIGINS must be set in production');
    }
  }

  // Development: allow wildcard if missing
  if (!raw || raw.trim() === '') {
    return ['*'];
  }

  // Split by comma, remove ALL whitespace/newlines, filter empty strings
  const origins = raw.split(',')
    .map(o => o.replace(/\s/g, '')) // Remove any whitespace or newlines globally
    .filter(o => o.length > 0);

  if (origins.length === 0) {
    if (isProduction) {
      console.error('[CORS] CRITICAL: ALLOWED_ORIGINS is empty after parsing');
      throw new Error('[CORS] CRITICAL: ALLOWED_ORIGINS must contain at least one origin in production');
    }
    return ['*'];
  }

  // Warn if wildcard found in production
  if (isProduction && origins.includes('*')) {
    console.warn('[CORS] ⚠️ WARNING: Wildcard (*) found in ALLOWED_ORIGINS in production. This allows all origins and is a security risk.');
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
