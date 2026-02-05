/**
 * QStash runtime environment guard (fail-fast).
 *
 * Goal: In production, do NOT allow the server to boot if critical QStash env vars
 * are missing. This prevents silent message loss / signature verification failure.
 */

function isProductionRuntime(): boolean {
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
 * Enforces presence of QStash secrets in production.
 * Throws a hard error immediately if missing.
 */
export function assertQstashEnv(): void {
  if (!isProductionRuntime()) return;

  // Producer/publisher token
  requireNonEmptyEnv('QSTASH_TOKEN');

  // Consumer/verification key (used by @upstash/qstash/nextjs verifySignatureAppRouter)
  requireNonEmptyEnv('QSTASH_CURRENT_SIGNING_KEY');
}

