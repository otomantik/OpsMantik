/**
 * DIC / Enhanced Conversions: UTF-8-only, salted SHA256 hashing for identity fields.
 * Use for phone (E.164) and other identifiers sent to Google Enhanced Conversions.
 * No Latin1; hash input is always UTF-8.
 */

import { createHash } from 'node:crypto';

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
 * Phone must be E.164 (digits only or with +); it is normalized to digits-only before hashing.
 *
 * @param e164Phone - E.164 number (e.g. "905321234567" or "+905321234567")
 * @param salt - Optional salt (UTF-8)
 * @returns SHA256 hash: lowercase hex, 64 chars. DIC/EC pipeline uses this format.
 */
export function hashPhoneForEC(e164Phone: string, salt: string = ''): string {
  const digitsOnly = (e164Phone || '').replace(/\D/g, '');
  if (!digitsOnly.length) return '';
  return sha256HexUtf8(digitsOnly, salt);
}

/**
 * Optional: return hash in base64 for APIs that expect base64.
 */
export function hashPhoneForECBase64(e164Phone: string, salt: string = ''): string {
  const digitsOnly = (e164Phone || '').replace(/\D/g, '');
  if (!digitsOnly.length) return '';
  return sha256Base64Utf8(digitsOnly, salt);
}
