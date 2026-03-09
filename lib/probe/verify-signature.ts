/**
 * OpsMantik Probe: ECDSA signature verification for intent and seal payloads.
 * Probe signs the canonical JSON (without signature field) with device key; we verify with stored public key.
 */

import { createPublicKey, createVerify } from 'node:crypto';

export interface VerifyResult {
  ok: boolean;
  error?: string;
}

/**
 * Verify ECDSA signature (Probe sends base64-encoded).
 * @param publicKeyPem - PEM-encoded public key from probe_devices
 * @param payload - The object that was signed (e.g. { idempotencyKey, phoneNumber, qualityScore, ... } without signature)
 * @param signatureBase64 - Base64-encoded ECDSA signature
 */
export function verifyProbeSignature(
  publicKeyPem: string,
  payload: Record<string, unknown>,
  signatureBase64: string
): VerifyResult {
  try {
    if (!publicKeyPem || !signatureBase64) {
      return { ok: false, error: 'Missing public key or signature' };
    }
    const key = createPublicKey(publicKeyPem);
    const message = canonicalJson(payload);
    const signature = Buffer.from(signatureBase64, 'base64');
    const verifier = createVerify('SHA256');
    verifier.update(message);
    const ok = verifier.verify(key, signature);
    return ok ? { ok: true } : { ok: false, error: 'Signature verification failed' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Canonical JSON: keys sorted, no whitespace, same as Probe signs.
 */
function canonicalJson(obj: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = obj[k];
  }
  return JSON.stringify(sorted);
}
