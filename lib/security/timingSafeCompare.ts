import { timingSafeEqual } from 'crypto';

/**
 * Constant-time string equality to mitigate timing attacks.
 *
 * This does NOT early-return on different lengths. It compares:
 * [len(4 bytes) | bytes | zero-padding] in constant time.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  const maxLen = Math.max(aBuf.length, bBuf.length);

  const aLen = Buffer.alloc(4);
  aLen.writeUInt32BE(aBuf.length, 0);
  const bLen = Buffer.alloc(4);
  bLen.writeUInt32BE(bBuf.length, 0);

  const aPad = Buffer.alloc(maxLen);
  const bPad = Buffer.alloc(maxLen);
  aBuf.copy(aPad);
  bBuf.copy(bPad);

  const aMsg = Buffer.concat([aLen, aPad]);
  const bMsg = Buffer.concat([bLen, bPad]);
  return timingSafeEqual(aMsg, bMsg);
}

