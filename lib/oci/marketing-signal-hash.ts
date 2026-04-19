import { createHash } from 'node:crypto';

/**
 * VOID ledger salt SSOT. The salt seasons the Merkle chain that protects
 * every marketing_signals.current_hash. Rotating or missing the salt breaks
 * integrity verification downstream, so we make it strictly required in
 * production and only fall back to a deterministic dev salt when we are
 * demonstrably NOT in production (test / local dev).
 */

const DEV_SALT = 'void_consensus_salt_dev_only_20260419';

let cachedSalt: string | null = null;

/**
 * Resolve the VOID ledger salt with fail-fast semantics.
 *   - Production: throws when VOID_LEDGER_SALT is unset / empty.
 *   - Test & development: returns a deterministic dev salt so local tooling
 *     and unit tests do not need a shared secret.
 *
 * The result is cached after the first successful resolution; reset the cache
 * only from tests that intentionally flip NODE_ENV at runtime.
 */
export function getVoidLedgerSalt(): string {
  if (cachedSalt !== null) return cachedSalt;

  const raw = process.env.VOID_LEDGER_SALT?.trim();
  if (raw) {
    cachedSalt = raw;
    return cachedSalt;
  }

  const env = (process.env.NODE_ENV ?? '').toLowerCase();
  const isProd = env === 'production';
  if (isProd) {
    throw new Error(
      'VOID_LEDGER_SALT is required in production. Set the env var before booting any service that touches marketing_signals or the OCI export pipeline.'
    );
  }

  cachedSalt = DEV_SALT;
  return cachedSalt;
}

/** Reset the cached salt. Test-only; do not call from runtime code. */
export function resetVoidLedgerSaltCacheForTests(): void {
  cachedSalt = null;
}

export function toExpectedValueCents(optimizationValue: number): number {
  return Math.max(Math.round(optimizationValue * 100), 1);
}

export function computeMarketingSignalCurrentHash(params: {
  callId: string | null;
  sequence: number;
  expectedValueCents: number;
  previousHash: string | null;
}): string {
  const salt = getVoidLedgerSalt();
  const payload = `${params.callId ?? 'null'}:${params.sequence}:${params.expectedValueCents}:${params.previousHash ?? 'null'}:${salt}`;
  return createHash('sha256').update(payload).digest('hex');
}
