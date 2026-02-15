/**
 * Cron auth guard: allow only Vercel Cron (x-vercel-cron) or valid Bearer CRON_SECRET.
 * In production: require x-vercel-cron unless ALLOW_BEARER_CRON=true (Bearer then fallback).
 * Returns null if allowed; returns 403 Response if forbidden (fail-closed).
 */

const CRON_FORBIDDEN_JSON = JSON.stringify({ error: 'forbidden', code: 'CRON_FORBIDDEN' });
const JSON_403_HEADERS = { 'Content-Type': 'application/json' } as const;

/**
 * Require cron auth. Use at the top of cron route handlers.
 * Production: x-vercel-cron required unless ALLOW_BEARER_CRON=true (then Bearer is fallback).
 * @param req - Request (Web API Request or NextRequest)
 * @returns null if allowed; Response (403 JSON) if forbidden
 */
export function requireCronAuth(req: Request): Response | null {
  const vercelCron = req.headers.get('x-vercel-cron');
  if (vercelCron === '1' || (vercelCron !== null && vercelCron !== '')) {
    return null;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const allowBearerCron = process.env.ALLOW_BEARER_CRON === 'true' || process.env.ALLOW_BEARER_CRON === '1';
  if (isProduction && !allowBearerCron) {
    return new Response(CRON_FORBIDDEN_JSON, { status: 403, headers: JSON_403_HEADERS });
  }

  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = req.headers.get('authorization');
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return null;
  }

  return new Response(CRON_FORBIDDEN_JSON, { status: 403, headers: JSON_403_HEADERS });
}
