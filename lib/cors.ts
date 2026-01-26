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
 * - Rejects: "https://example.com.evil.com"
 * 
 * @param origin - Origin header value (e.g., "https://example.com")
 * @param allowedOrigins - Array of allowed origins from parseAllowedOrigins()
 * @returns true if origin is allowed
 */
export function isOriginAllowed(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin) return false;

  // Wildcard allows all (security warning handled in parseAllowedOrigins)
  if (allowedOrigins.includes('*')) return true;

  const normalizedOrigin = origin.toLowerCase().trim().replace(/\/$/, '');

  return allowedOrigins.some(allowed => {
    const normalizedAllowed = allowed.toLowerCase().trim().replace(/\/$/, '');

    // 1. Exact match (scheme + host + port)
    if (normalizedOrigin === normalizedAllowed) return true;

    // 2. Subdomain check (scheme + host suffix)
    try {
      const originUrl = new URL(normalizedOrigin);
      const allowedUrl = new URL(normalizedAllowed);

      // Protocols must match
      if (originUrl.protocol !== allowedUrl.protocol) return false;

      // Origin hostname must end with "." + allowed hostname
      // e.g. "www.example.com" ends with ".example.com"
      if (originUrl.hostname.endsWith('.' + allowedUrl.hostname)) {
        return true;
      }
    } catch {
      // If either is not a valid URL, fallback to string match (if allowed doesn't have protocol)
      if (!normalizedAllowed.includes('://')) {
        const originHost = normalizedOrigin.replace(/^https?:\/\//, '').split('/')[0];
        if (originHost === normalizedAllowed || originHost.endsWith('.' + normalizedAllowed)) {
          return true;
        }
      }
    }

    return false;
  });
}
