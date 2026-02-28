/**
 * Iron Seal: OCI session token create & verify.
 * Shared by v2/verify (create), google-ads-export and ack (verify).
 */

import { createHmac } from 'node:crypto';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';

const SESSION_SECRET = () =>
  process.env.OCI_SESSION_SECRET || process.env.CRON_SECRET || process.env.OCI_API_KEY || '';

/** Create HMAC-signed session token. Payload: siteId|exp */
export function createSessionToken(siteId: string, expiresAt: number): string {
  const secret = SESSION_SECRET();
  if (!secret) throw new Error('OCI_SESSION_SECRET or CRON_SECRET required');
  const payload = `${siteId}|${expiresAt}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`;
}

/** Verify session token and return { siteId } or null */
export function verifySessionToken(token: string): { siteId: string; expiresAt: number } | null {
  try {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return null;
    const payload = Buffer.from(b64, 'base64url').toString('utf8');
    const [siteId, expStr] = payload.split('|');
    if (!siteId || !expStr) return null;
    const expiresAt = parseInt(expStr, 10);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now() / 1000) return null;

    const secret = process.env.OCI_SESSION_SECRET || process.env.CRON_SECRET || process.env.OCI_API_KEY || '';
    const expectedSig = createHmac('sha256', secret).update(payload).digest('base64url');
    if (!timingSafeCompare(sig, expectedSig)) return null;

    return { siteId, expiresAt };
  } catch {
    return null;
  }
}
