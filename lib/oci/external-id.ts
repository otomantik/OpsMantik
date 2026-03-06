import crypto from 'crypto';

type ExternalIdInput = {
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
 */
export function computeOfflineConversionExternalId(input: ExternalIdInput): string {
  const providerKey = normalizeToken(input.providerKey, 'google_ads');
  const action = normalizeToken(input.action, 'purchase');
  const saleId = normalizeToken(input.saleId);
  const callId = normalizeToken(input.callId);
  const sessionId = normalizeToken(input.sessionId);
  const fingerprint = `${providerKey}|${action}|${saleId}|${callId}|${sessionId}`;
  return `oci_${crypto.createHash('md5').update(fingerprint).digest('hex')}`;
}
