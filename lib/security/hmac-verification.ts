import { createHmac } from 'crypto';
import { timingSafeCompare } from './timing-safe-compare';

/**
 * Iron Protocol v3: HMAC Verification
 * Verifies that the payload was signed by a secret known only to the site.
 */

export function verifyHmacSignature(params: {
  payload: string;
  signature: string;
  secret: string;
}): boolean {
  const { payload, signature, secret } = params;
  
  if (!signature || !secret) return false;

  const expectedSignature = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  // We should also check for base64 if the script sends base64
  // Google Ads Utilities.computeHmacSha256Signature returns byte[]
  // but usually we convert it to hex for headers.
  
  return timingSafeCompare(expectedSignature, signature);
}
