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
 * Normalize origin/host to hostname only (strip protocol, port, path, lowercase)
 * 
 * @param origin - Full origin URL (e.g., "https://example.com:443/path")
 * @returns Normalized hostname (e.g., "example.com")
 */
function normalizeHost(origin: string): string {
  try {
    // If already a hostname (no protocol), use as-is
    if (!origin.includes('://')) {
      return origin.toLowerCase().split('/')[0].split(':')[0];
    }

    const urlObj = new URL(origin);
    // Return hostname only (no port, no path)
    return urlObj.hostname.toLowerCase();
  } catch {
    // If URL parsing fails, try to extract hostname manually
    // Remove protocol, port, path
    return origin
      .replace(/^https?:\/\//, '')
      .replace(/^\/\//, '')
      .split('/')[0]
      .split(':')[0]
      .toLowerCase();
  }
}

/**
 * Check if origin is allowed using safe domain matching
 * 
 * Rules:
 * - Wildcard '*' allows all (with warning in production)
 * - Exact host match: "example.com" === "example.com"
 * - Subdomain match: "www.example.com" ends with ".example.com"
 * - Rejects: "example.com.evil.com" (does not end with ".example.com")
 * - Rejects: "malicious-example.com" (not exact, not subdomain)
 * 
 * @param origin - Origin header value (e.g., "https://example.com")
 * @param allowedOrigins - Array of allowed origins from parseAllowedOrigins()
 * @returns true if origin is allowed
 */
export function isOriginAllowed(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin) return false;

  // Wildcard allows all (with warning in production - already warned in parseAllowedOrigins)
  if (allowedOrigins.includes('*')) return true;

  const normalizedOrigin = normalizeHost(origin);

  // Check against allowed origins
  return allowedOrigins.some(allowed => {
    // Normalize allowed origin
    let normalizedAllowed: string;

    if (allowed.startsWith('http://') || allowed.startsWith('https://')) {
      normalizedAllowed = normalizeHost(allowed);
    } else {
      // If no protocol, assume it's already a hostname
      normalizedAllowed = normalizeHost(allowed);
    }

    // Exact match
    if (normalizedOrigin === normalizedAllowed) {
      return true;
    }

    // Subdomain match: origin must end with "." + allowed host
    // Example: "www.example.com" ends with ".example.com"
    // This rejects "example.com.evil.com" because it doesn't end with ".example.com"
    if (normalizedOrigin.endsWith('.' + normalizedAllowed)) {
      return true;
    }

    // No match
    return false;
  });
}
