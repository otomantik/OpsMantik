import { createHmac } from 'crypto';
import { timingSafeCompare } from './timingSafeCompare';

export type VerifySignedRequestOk = { ok: true; siteId: string; ts: number };
export type VerifySignedRequestFail = { ok: false; error: string };
export type VerifySignedRequestResult = VerifySignedRequestOk | VerifySignedRequestFail;

function getHeader(headers: Headers, name: string): string | null {
  // NextRequest headers are case-insensitive, but normalize anyway.
  return headers.get(name) ?? headers.get(name.toLowerCase()) ?? null;
}

function isHex(str: string): boolean {
  return /^[0-9a-f]+$/i.test(str);
}

/**
 * Verify HMAC-signed public requests.
 *
 * Expected headers:
 * - x-ops-site-id: <site public id>
 * - x-ops-ts: unix seconds (string)
 * - x-ops-signature: hex(hmacSHA256(secret, `${ts}.${rawBody}`))
 */
export function verifySignedRequest({
  rawBody,
  headers,
  secrets,
  nowSec = Math.floor(Date.now() / 1000),
  maxAgeSec = 300,
}: {
  rawBody: string;
  headers: Headers;
  secrets: string[];
  nowSec?: number;
  maxAgeSec?: number;
}): VerifySignedRequestResult {
  const siteId = (getHeader(headers, 'x-ops-site-id') || '').trim();
  const tsRaw = (getHeader(headers, 'x-ops-ts') || '').trim();
  const sig = (getHeader(headers, 'x-ops-signature') || '').trim().toLowerCase();

  if (!siteId) return { ok: false, error: 'Missing x-ops-site-id' };
  if (!tsRaw) return { ok: false, error: 'Missing x-ops-ts' };
  if (!sig) return { ok: false, error: 'Missing x-ops-signature' };
  if (!/^\d{9,12}$/.test(tsRaw)) return { ok: false, error: 'Invalid x-ops-ts' };
  if (!isHex(sig) || sig.length !== 64) return { ok: false, error: 'Invalid x-ops-signature' };

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) return { ok: false, error: 'Invalid x-ops-ts' };

  // Replay protection: reject if older than maxAgeSec
  if (nowSec - ts > maxAgeSec) return { ok: false, error: 'Signature expired' };
  // Small future skew tolerance (clock drift)
  if (ts - nowSec > 60) return { ok: false, error: 'Signature from future' };

  if (!Array.isArray(secrets) || secrets.length === 0) return { ok: false, error: 'Server misconfigured' };

  const message = `${tsRaw}.${rawBody}`;
  for (const secret of secrets) {
    if (!secret) continue;
    const expected = createHmac('sha256', secret).update(message, 'utf8').digest('hex');
    if (timingSafeCompare(expected, sig)) {
      return { ok: true, siteId, ts };
    }
  }

  return { ok: false, error: 'Invalid signature' };
}

