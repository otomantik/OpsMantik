/**
 * QStash runtime environment guard (fail-fast).
 *
 * Required in production:
 * - QSTASH_TOKEN: Publisher token for enqueueing messages.
 * - QSTASH_CURRENT_SIGNING_KEY: Current signing key; required to verify request signatures.
 *
 * Optional (key rotation):
 * - QSTASH_NEXT_SIGNING_KEY: Next signing key. If missing, current is used for both;
 *   set both during rotation to avoid 403s.
 *
 * Local dev bypass for /api/sync/worker only:
 * - NODE_ENV != production and ALLOW_INSECURE_DEV_WORKER=true to skip verification (insecure).
 */

function isProductionRuntime(): boolean {
  // If we are in the build phase (collecting data), we may not have the secrets.
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.IS_BUILDING === 'true') {
    return false;
  }
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

function requireNonEmptyEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new Error(`[QSTASH] CRITICAL: Missing required env var in production: ${name}`);
  }
  return String(v).trim();
}

/**
 * Enforces presence of QStash secrets in production (500 on startup if missing).
 * Signature verification is enforced by requireQstashSignature in the worker route.
 */
export function assertQstashEnv(): void {
  if (!isProductionRuntime()) return;

  requireNonEmptyEnv('QSTASH_TOKEN');
  requireNonEmptyEnv('QSTASH_CURRENT_SIGNING_KEY');
}

