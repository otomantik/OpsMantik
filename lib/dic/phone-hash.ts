/**
 * phone-hash — SSOT for converting a raw phone string into the
 * `caller_phone_hash_sha256` identifier used across the system.
 *
 * Callers previously did one of several things:
 *
 *   - seal route:  normalizeToE164(raw, iso) → hashPhoneForEC(e164, salt)
 *   - stage route: raw.replace(/[^\d+]/g, '') → crypto.createHash('sha256').digest('hex')
 *   - export/runner: read `caller_phone_hash_sha256` straight from `calls` (no normalization)
 *
 * The second path is dangerous because it skips Zero-Trust normalization. The third is fine but relies on the first two
 * having written a consistent value. This module consolidates the
 * "raw phone → stored + sendable hash" transform behind one function so every
 * write site produces a byte-identical hash for the same underlying number.
 */

import { normalizeToE164 } from './e164';
import {
  normalizePhoneToE164,
  sha256Hex,
  PhoneNormalizeError,
} from '@/lib/oci/validation/crypto';

export interface HashedPhoneResult {
  /** Raw input after trimming (≤64 chars, UI-safe). */
  raw: string;
  /** Digits-only E.164 string (no +). null if raw could not be normalized. */
  e164: string | null;
  /** SHA-256 hex (64 chars lowercase) over UTF-8 of `+<e164>` (PR-9H.7A). null iff normalization/hash failed. */
  hash: string | null;
  /** Indicates why e164 / hash are null. */
  reason: 'ok' | 'empty_input' | 'normalization_failed' | 'hash_failed';
}

export interface BuildPhoneIdentityParams {
  rawPhone: string | null | undefined;
  /** ISO 3166-1 alpha-2 (e.g. 'TR', 'US'). Falls back to 'TR' if empty. */
  countryIso: string | null | undefined;
  /** @deprecated PR-9H.7A — stored hash is unsalted; kept for call-site compatibility only. */
  salt?: string | null;
}

/**
 * Legacy env reader (salt no longer participates in `buildPhoneIdentity` / PR-9H.7A hash).
 */
export function resolvePhoneHashSalt(override?: string | null): string {
  if (typeof override === 'string') return override;
  return process.env.OCI_PHONE_HASH_SALT ?? '';
}

/**
 * Hash an already-normalized E.164 string for Enhanced Conversions. Use this
 * from the export / runner paths that read `caller_phone_e164` from the DB
 * and need a Google-compatible SHA-256. All other callers should start from
 * a raw phone via `buildPhoneIdentity`.
 *
 * Returns null when the input is empty or the hash call throws — never
 * raises, so gate/export logic can fail soft to click-id fallbacks.
 */
export function hashE164ForEnhancedConversions(
  e164: string | null | undefined,
  _saltOverride?: string | null
): string | null {
  if (typeof e164 !== 'string' || !e164.trim()) return null;
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  try {
    return sha256Hex(`+${digits}`);
  } catch {
    return null;
  }
}

/**
 * Build the canonical caller phone identity (raw trim + digits-only E.164 column + SSOT hex hash).
 * Fails soft: returns partially-null results rather than throwing so that
 * seal/stage paths can persist the caller row even if normalization fails.
 */
export function buildPhoneIdentity(params: BuildPhoneIdentityParams): HashedPhoneResult {
  const raw = typeof params.rawPhone === 'string' ? params.rawPhone.trim().slice(0, 64) : '';
  if (!raw) {
    return { raw: '', e164: null, hash: null, reason: 'empty_input' };
  }

  const iso = (params.countryIso ?? '').trim() || 'TR';
  try {
    const e164Plus = normalizePhoneToE164(raw, { defaultCountryIso: iso });
    const hash = sha256Hex(e164Plus);
    const e164 = e164Plus.slice(1);
    return { raw, e164, hash, reason: 'ok' };
  } catch (e) {
    if (e instanceof PhoneNormalizeError && e.code === 'EMPTY_PHONE') {
      return { raw: '', e164: null, hash: null, reason: 'empty_input' };
    }
    const e164Digits = normalizeToE164(raw, iso);
    if (!e164Digits) {
      return { raw, e164: null, hash: null, reason: 'normalization_failed' };
    }
    return { raw, e164: e164Digits, hash: null, reason: 'hash_failed' };
  }
}
