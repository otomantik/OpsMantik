/**
 * DIC / Enhanced Conversions: UTF-8-only, salted SHA256 hashing for identity fields.
 * Use for phone (E.164) and other identifiers sent to Google Enhanced Conversions.
 * No Latin1; hash input is always UTF-8.
 * Abyss Protocol: Zero-Trust phone sanitization before digest.
 */

import { createHash } from 'node:crypto';

const HASHED_PHONE_HEX_LENGTH = 64;

/**
 * Zero-Trust phone sanitizer for SHA-256 digest. Structural wipe: only digits and '+'.
 * E.164 prefix routing: 00 -> +, 05 -> +90, else leading +.
 * Idempotent: if input is already 64-char hex (existing hash), return lowercased.
 *
 * @param rawInput - Raw phone or existing 64-char hex hash
 * @returns E.164 digits-only string for hashing, or throws on invalid hash length
 */
export function sanitizePhoneForHash(rawInput: string): string {
  const raw = String(rawInput).trim();
  if (!raw) throw new Error('ABYSS_ERR: Empty phone input');

  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return raw.toLowerCase();
  }

  let digitsOnly = raw.replace(/[^\d+]/g, '');
  digitsOnly = digitsOnly.replace(/\D/g, '');
  if (digitsOnly.length === 0) throw new Error('ABYSS_ERR: No digits in phone');

  if (digitsOnly.startsWith('00')) {
    digitsOnly = digitsOnly.slice(2);
  } else if (digitsOnly.startsWith('0') && digitsOnly.length >= 10 && digitsOnly.charAt(1) === '5') {
    digitsOnly = '90' + digitsOnly.slice(1);
  } else if (digitsOnly.startsWith('90') && digitsOnly.length >= 12) {
    digitsOnly = digitsOnly;
  } else if (!digitsOnly.startsWith('90') && digitsOnly.length >= 10) {
    digitsOnly = '90' + digitsOnly;
  }
  return digitsOnly;
}

/**
 * SHA-256 hash with exact 64-char hex assertion. For use after sanitizePhoneForHash(digitsOnly).
 */
export function sha256Hex64(value: string): string {
  const hash = createHash('sha256').update(value, 'utf8').digest('hex');
  if (hash.length !== HASHED_PHONE_HEX_LENGTH) {
    throw new Error(`ABYSS_ERR: Cryptographic Failure - Invalid Hash Length (got ${hash.length})`);
  }
  return hash.toLowerCase();
}

/**
 * Hashes a string with SHA256 using UTF-8 encoding and optional salt.
 * Pipeline constraint: UTF-8 only, no Latin1.
 *
 * @param value - E.164 phone or other identifier (will be encoded as UTF-8)
 * @param salt - Optional salt (e.g. per-upload or per-customer); also UTF-8
 * @returns Lowercase hex string of SHA256(salt + value)
 */
export function sha256HexUtf8(value: string, salt: string = ''): string {
  const encoded = Buffer.from(salt + value, 'utf8');
  return createHash('sha256').update(encoded).digest('hex').toLowerCase();
}

/**
 * Same as sha256HexUtf8 but returns base64 (some Google APIs accept base64 for hashed_user_identifier).
 */
export function sha256Base64Utf8(value: string, salt: string = ''): string {
  const encoded = Buffer.from(salt + value, 'utf8');
  return createHash('sha256').update(encoded).digest('base64');
}

/**
 * Builds a phone hash suitable for Google Enhanced Conversions.
 * Uses Zero-Trust sanitizer (E.164 prefix routing, digits-only) then SHA-256 with exact 64-char assert.
 *
 * @param e164Phone - Raw phone (e.g. "0532 123 45 67", "+905321234567") or existing 64-char hex hash
 * @param salt - Optional salt (UTF-8); applied after sanitization
 * @returns SHA256 hash: lowercase hex, 64 chars. Throws on invalid input or hash length.
 */
export function hashPhoneForEC(e164Phone: string, salt: string = ''): string {
  const sanitized = sanitizePhoneForHash(e164Phone);
  if (sanitized.length === HASHED_PHONE_HEX_LENGTH && /^[a-f0-9]+$/.test(sanitized)) {
    return sanitized;
  }
  const hash = sha256HexUtf8(sanitized, salt);
  if (hash.length !== HASHED_PHONE_HEX_LENGTH) {
    throw new Error(`ABYSS_ERR: Cryptographic Failure - Invalid Hash Length (got ${hash.length})`);
  }
  return hash;
}

/**
 * Optional: return hash in base64 for APIs that expect base64.
 */
export function hashPhoneForECBase64(e164Phone: string, salt: string = ''): string {
  const digitsOnly = (e164Phone || '').replace(/\D/g, '');
  if (!digitsOnly.length) return '';
  return sha256Base64Utf8(digitsOnly, salt);
}
