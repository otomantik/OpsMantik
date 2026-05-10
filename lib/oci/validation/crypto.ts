/**
 * PR-9H.7A — OCI cryptographic SSOT for enhanced conversions phone hashing (Node/DB-aligned contract).
 *
 * Canonical hash input: **normalized E.164 with leading '+'** (e.g. "+905321234567").
 * Hash: lowercase 64-char SHA-256 hex over UTF-8 bytes of that string only (no salt).
 */

import { createHash } from 'node:crypto';
import { normalizeToE164 } from '@/lib/dic/e164';

export class PhoneNormalizeError extends Error {
  constructor(
    message: string,
    public readonly code: 'EMPTY_PHONE' | 'INVALID_PHONE'
  ) {
    super(message);
    this.name = 'PhoneNormalizeError';
  }
}

/** Normalization/version token stored on journal user_identifiers for phone-hash provenance (PR-9H.7A). */
export const EC_PHONE_HASH_NORMALIZATION_VERSION = 'e164_sha256_v1';

export type NormalizePhoneOptions = {
  /** ISO 3166-1 alpha-2 for default CC when absent (default `"TR"` → +90). */
  defaultCountryIso?: string;
};

/**
 * Normalize to E.164 **with '+' prefix**. Throws deterministic errors — no silent NULL.
 *
 * Implemented via `@/lib/dic/e164.normalizeToE164` (digits) then '+' prefix for hash contract.
 */
export function normalizePhoneToE164(rawPhone: string | null | undefined, options?: NormalizePhoneOptions): string {
  if (rawPhone == null || typeof rawPhone !== 'string' || !rawPhone.trim()) {
    throw new PhoneNormalizeError('Phone input is empty', 'EMPTY_PHONE');
  }
  const trimmed = rawPhone.trim();
  const iso = (options?.defaultCountryIso ?? 'TR').trim().toUpperCase().slice(0, 2) || 'TR';
  const digits = normalizeToE164(trimmed, iso);
  if (!digits) {
    throw new PhoneNormalizeError('Phone could not be normalized to E.164', 'INVALID_PHONE');
  }
  return `+${digits}`;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').toLowerCase();
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value.trim().toLowerCase());
}

/** Hash raw phone → normalize E.164 (+prefix) → sha256 hex (64 chars). */
export function hashPhoneSha256E164(rawPhone: string | null | undefined, options?: NormalizePhoneOptions): string {
  const e164 = normalizePhoneToE164(rawPhone, options);
  return sha256Hex(e164);
}

/**
 * Hash an already-canonical **`+digits` E.164** string only (caller must normalize first).
 */
export function hashPhoneSha256E164Only(normalizedPhoneWithPlus: string | null | undefined): string {
  const t = String(normalizedPhoneWithPlus ?? '').trim();
  if (!/^\+[1-9]\d{6,14}$/.test(t)) {
    throw new PhoneNormalizeError(
      'Normalized phone must be E.164 (+ prefix and 7–15 subscriber digits)',
      'INVALID_PHONE'
    );
  }
  return sha256Hex(t);
}

export function normalizeEmailForHash(input: string | null | undefined): string | null {
  if (!input) return null;
  const out = input.trim().toLowerCase();
  return out.length > 0 ? out : null;
}

export function hashNormalizedEmail(input: string | null | undefined): string | null {
  const normalized = normalizeEmailForHash(input);
  return normalized ? sha256Hex(normalized) : null;
}

/**
 * @deprecated Use `hashPhoneSha256E164` (throws). This legacy helper mirrors old soft-null behavior.
 */
export function hashNormalizedPhoneE164(
  input: string | null | undefined,
  options?: NormalizePhoneOptions
): { e164: string; sha256: string } | null {
  try {
    const e164 = normalizePhoneToE164(input, options);
    return { e164, sha256: sha256Hex(e164) };
  } catch {
    return null;
  }
}
