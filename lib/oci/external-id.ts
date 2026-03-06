import crypto from 'crypto';

export type ExternalIdInput = {
  providerKey?: string | null;
  action?: string | null;
  saleId?: string | null;
  callId?: string | null;
  sessionId?: string | null;
};

function normalizeToken(value: string | null | undefined, fallback = ''): string {
  const trimmed = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return trimmed || fallback;
}

/**
 * DB-authoritative OCI identity. The same logical conversion must always hash
 * to the same external_id so retries collide at the unique index.
 *
 * Uses SHA-256 (first 32 hex chars = 128 bits) — collision-resistant and
 * consistent with the DB-side `encode(sha256(...), 'hex')` implementation.
 *
 * Requires at least one non-empty identity field (saleId, callId, or sessionId)
 * to prevent all-null collisions where unrelated orphaned conversions map to the
 * same hash and the second insert is silently dropped.
 */
export function computeOfflineConversionExternalId(input: ExternalIdInput): string {
  const providerKey = normalizeToken(input.providerKey, 'google_ads');
  const action = normalizeToken(input.action, 'purchase');
  const saleId = normalizeToken(input.saleId);
  const callId = normalizeToken(input.callId);
  const sessionId = normalizeToken(input.sessionId);

  if (!saleId && !callId && !sessionId) {
    throw new Error(
      'computeOfflineConversionExternalId: at least one of saleId, callId, or sessionId must be non-empty. ' +
      'All-null inputs would produce identical external_id values across unrelated conversions.'
    );
  }

  const fingerprint = `${providerKey}|${action}|${saleId}|${callId}|${sessionId}`;
  // SHA-256, truncated to 128 bits (32 hex chars) — matches DB sha256() implementation
  return `oci_${crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 32)}`;
}
