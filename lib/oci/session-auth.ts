/**
 * Iron Seal: OCI session token create & verify — Ed25519 Edition
 *
 * Upgraded from HMAC-SHA256 to Ed25519 (OKP, crv: Ed25519) for JWS signing.
 * Ed25519 advantages over HMAC-SHA256 for this use-case:
 *   - Asymmetric: public key can be shared for verification without exposing secrets
 *   - Constant-time verification natively in the WebCrypto spec (no timing attacks)
 *   - ~1000x faster than RSA-2048 for sign/verify at equivalent security level
 *   - Post-Quantum transition: Ed25519 is the preferred migration stepping stone
 *
 * ENV VARS REQUIRED:
 *   OCI_ED25519_PRIVATE_KEY_B64  — Base64-encoded 64-byte Ed25519 private seed (generate once)
 *   OCI_ED25519_PUBLIC_KEY_B64   — Base64-encoded 32-byte Ed25519 public key
 *
 * FALLBACK:
 *   If Ed25519 keys are not configured, falls back to HMAC-SHA256 (legacy compat).
 */

import { SignJWT, jwtVerify, importPKCS8, importSPKI, generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { createHmac } from 'node:crypto';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';

const ALGORITHM = 'EdDSA';
const TOKEN_EXPIRY_SECONDS = 3600; // 1 hour

// ─────────────────────────────────────────────────────────────────────────────
// Key helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getPrivateKey() {
  const b64 = process.env.OCI_ED25519_PRIVATE_KEY_B64;
  if (!b64) return null;
  const pem = Buffer.from(b64, 'base64').toString('utf8');
  return importPKCS8(pem, ALGORITHM);
}

async function getPublicKey() {
  const b64 = process.env.OCI_ED25519_PUBLIC_KEY_B64;
  if (!b64) return null;
  const pem = Buffer.from(b64, 'base64').toString('utf8');
  return importSPKI(pem, ALGORITHM);
}

function isEd25519Configured(): boolean {
  return !!(process.env.OCI_ED25519_PRIVATE_KEY_B64 && process.env.OCI_ED25519_PUBLIC_KEY_B64);
}

// ─────────────────────────────────────────────────────────────────────────────
// Token create (Ed25519 JWT or HMAC legacy)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a signed session token for a site.
 * Uses Ed25519 JWS if keys configured, falls back to HMAC.
 */
export async function createSessionToken(siteId: string, expiresAt?: number): Promise<string> {
  const exp = expiresAt ?? Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS;

  if (isEd25519Configured()) {
    const privateKey = await getPrivateKey();
    if (!privateKey) throw new Error('OCI_ED25519_PRIVATE_KEY_B64 failed to import');

    return new SignJWT({ siteId })
      .setProtectedHeader({ alg: ALGORITHM })
      .setIssuedAt()
      .setExpirationTime(exp)
      .setSubject(siteId)
      .sign(privateKey);
  }

  // Legacy HMAC fallback
  const secret = legacySecret();
  if (!secret) throw new Error('OCI_SESSION_SECRET, CRON_SECRET, or Ed25519 key required');
  const payload = `${siteId}|${exp}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token verify (Ed25519 JWT or HMAC legacy)
// ─────────────────────────────────────────────────────────────────────────────

/** Verify session token and return { siteId } or null */
export async function verifySessionToken(token: string): Promise<{ siteId: string; expiresAt: number } | null> {
  try {
    // Detect format: JWT has 3 segments (header.payload.sig)
    const segments = token.split('.');
    if (segments.length === 3 && isEd25519Configured()) {
      const publicKey = await getPublicKey();
      if (!publicKey) return null;

      const { payload } = await jwtVerify(token, publicKey, { algorithms: [ALGORITHM] });
      const siteId = payload['siteId'] as string | undefined ?? payload.sub;
      const exp = payload.exp;

      if (!siteId || !exp || exp < Math.floor(Date.now() / 1000)) return null;
      return { siteId, expiresAt: exp };
    }

    // Legacy HMAC path (2-segment base64url.sig)
    if (segments.length === 2) {
      const [b64, sig] = segments;
      if (!b64 || !sig) return null;
      const payloadStr = Buffer.from(b64, 'base64url').toString('utf8');
      const [siteId, expStr] = payloadStr.split('|');
      if (!siteId || !expStr) return null;
      const expiresAt = parseInt(expStr, 10);
      if (!Number.isFinite(expiresAt) || expiresAt < Date.now() / 1000) return null;

      const secret = legacySecret();
      if (!secret) return null;
      const expectedSig = createHmac('sha256', secret).update(payloadStr).digest('base64url');
      if (!timingSafeCompare(sig, expectedSig)) return null;
      return { siteId, expiresAt };
    }

    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync compatibility shim (for callers that don't await)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Synchronous verify — legacy HMAC only.
 * For code paths that cannot use async (e.g. middleware).
 * Ed25519 requires async; returns null for JWT tokens.
 */
export function verifySessionTokenSync(token: string): { siteId: string; expiresAt: number } | null {
  try {
    const segments = token.split('.');
    if (segments.length !== 2) return null; // JWT requires async

    const [b64, sig] = segments;
    if (!b64 || !sig) return null;
    const payloadStr = Buffer.from(b64, 'base64url').toString('utf8');
    const [siteId, expStr] = payloadStr.split('|');
    if (!siteId || !expStr) return null;
    const expiresAt = parseInt(expStr, 10);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now() / 1000) return null;

    const secret = legacySecret();
    if (!secret) return null;
    const expectedSig = createHmac('sha256', secret).update(payloadStr).digest('base64url');
    if (!timingSafeCompare(sig, expectedSig)) return null;
    return { siteId, expiresAt };
  } catch {
    return null;
  }
}

function legacySecret(): string {
  return process.env.OCI_SESSION_SECRET || process.env.CRON_SECRET || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Key generation utility (run once, store in env)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a new Ed25519 key pair and print it to stdout.
 * Run via: npx tsx -e "import { generateAndPrintKeys } from './lib/oci/session-auth.ts'; await generateAndPrintKeys();"
 *
 * Store the output in OCI_ED25519_PRIVATE_KEY_B64 and OCI_ED25519_PUBLIC_KEY_B64.
 */
export async function generateAndPrintKeys(): Promise<void> {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
  const privPem = await exportPKCS8(privateKey);
  const pubPem = await exportSPKI(publicKey);
  console.log('OCI_ED25519_PRIVATE_KEY_B64=' + Buffer.from(privPem).toString('base64'));
  console.log('OCI_ED25519_PUBLIC_KEY_B64=' + Buffer.from(pubPem).toString('base64'));
}
