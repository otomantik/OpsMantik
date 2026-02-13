/**
 * Cron auth guard: allow only Vercel Cron (x-vercel-cron) or valid Bearer CRON_SECRET.
 * Returns null if allowed; returns 403 Response if forbidden (fail-closed).
 */

const CRON_FORBIDDEN_JSON = JSON.stringify({ error: 'forbidden', code: 'CRON_FORBIDDEN' });
const JSON_403_HEADERS = { 'Content-Type': 'application/json' } as const;

/**
 * Require cron auth. Use at the top of cron route handlers.
 * @param req - Request (Web API Request or NextRequest)
 * @returns null if allowed; Response (403 JSON) if forbidden
 */
export function requireCronAuth(req: Request): Response | null {
  const vercelCron = req.headers.get('x-vercel-cron');
  if (vercelCron === '1' || (vercelCron !== null && vercelCron !== '')) {
    return null;
  }

  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = req.headers.get('authorization');
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return null;
  }

  return new Response(CRON_FORBIDDEN_JSON, { status: 403, headers: JSON_403_HEADERS });
}
