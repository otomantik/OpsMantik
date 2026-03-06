/**
 * Cron auth guard: production hybrid mode is dual-key.
 * - Provenance: x-vercel-cron=1 + x-vercel-id
 * - Execution: Authorization: Bearer ${CRON_SECRET}
 * Header provenance alone is never enough to execute in production.
 */

const CRON_FORBIDDEN_JSON = JSON.stringify({ error: 'forbidden', code: 'CRON_FORBIDDEN' });
const JSON_403_HEADERS = { 'Content-Type': 'application/json' } as const;

function isMissingOrPlaceholderSecret(value: string | undefined): boolean {
  const normalized = value?.trim();
  if (!normalized) return true;
  const lowered = normalized.toLowerCase();
  return ['changeme', 'change-me', 'default', 'placeholder', 'cron_secret', 'your-cron-secret'].includes(lowered);
}

function getCronAuthMode(): 'hybrid' | 'bearer_only' {
  const raw = process.env.CRON_AUTH_MODE?.trim().toLowerCase();
  if (raw === 'bearer_only' || raw === 'bearer' || raw === 'strict_bearer') {
    return 'bearer_only';
  }
  return 'hybrid';
}

/**
 * Require cron auth. Use at the top of cron route handlers.
 * Hybrid mode:
 * - production => require BOTH trusted Vercel provenance and Bearer CRON_SECRET
 * - non-production => allow trusted Vercel provenance OR valid Bearer for manual ops
 * Bearer-only mode: require Authorization: Bearer CRON_SECRET in every environment.
 * @param req - Request (Web API Request or NextRequest)
 * @returns null if allowed; Response (403 JSON) if forbidden
 */
export function requireCronAuth(req: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && isMissingOrPlaceholderSecret(cronSecret)) {
    return new Response(CRON_FORBIDDEN_JSON, { status: 403, headers: JSON_403_HEADERS });
  }

  const authHeader = req.headers.get('authorization');
  const hasValidBearer = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
  const vercelCron = req.headers.get('x-vercel-cron');
  const vercelRequestId = req.headers.get('x-vercel-id');
  const hasTrustedVercelProvenance = vercelCron === '1' && Boolean(vercelRequestId && vercelRequestId.trim() !== '');

  if (getCronAuthMode() === 'bearer_only') {
    return hasValidBearer
      ? null
      : new Response(CRON_FORBIDDEN_JSON, { status: 403, headers: JSON_403_HEADERS });
  }

  if (isProduction) {
    return hasTrustedVercelProvenance && hasValidBearer
      ? null
      : new Response(CRON_FORBIDDEN_JSON, { status: 403, headers: JSON_403_HEADERS });
  }

  if (hasTrustedVercelProvenance || hasValidBearer) {
    return null;
  }
  return new Response(CRON_FORBIDDEN_JSON, { status: 403, headers: JSON_403_HEADERS });
}
