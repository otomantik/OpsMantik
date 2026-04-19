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
 * The second path is dangerous because it skips Zero-Trust sanitization and
 * the Enhanced Conversions salt. The third is fine but relies on the first two
 * having written a consistent value. This module consolidates the
 * "raw phone → stored + sendable hash" transform behind one function so every
 * write site produces a byte-identical hash for the same underlying number.
 */

import { normalizeToE164 } from './e164';
import { hashPhoneForEC } from './identity-hash';

export interface HashedPhoneResult {
  /** Raw input after trimming (≤64 chars, UI-safe). */
  raw: string;
  /** Digits-only E.164 string (no +). null if raw could not be normalized. */
  e164: string | null;
  /** Salted SHA-256 hex (64 chars) of the E.164. null iff e164 is null. */
  hash: string | null;
  /** Indicates why e164 / hash are null. */
  reason: 'ok' | 'empty_input' | 'normalization_failed' | 'hash_failed';
}

export interface BuildPhoneIdentityParams {
  rawPhone: string | null | undefined;
  /** ISO 3166-1 alpha-2 (e.g. 'TR', 'US'). Falls back to 'TR' if empty. */
  countryIso: string | null | undefined;
  /**
   * Optional override for OCI_PHONE_HASH_SALT. Tests pass a deterministic salt;
   * runtime code usually leaves this undefined so the env var is read.
   */
  salt?: string | null;
}

/**
 * Resolve the current phone hash salt. Reads OCI_PHONE_HASH_SALT (defaulting
 * to the empty string) so every caller — seal, stage, export, runner —
 * produces byte-identical hashes without each site re-reading the env var.
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
  saltOverride?: string | null
): string | null {
  if (typeof e164 !== 'string' || !e164.trim()) return null;
  try {
    return hashPhoneForEC(e164.trim(), resolvePhoneHashSalt(saltOverride));
  } catch {
    return null;
  }
}

/**
 * Build the canonical caller phone identity (raw + e164 + salted hash).
 * Fails soft: returns partially-null results rather than throwing so that
 * seal/stage paths can persist the raw value even if normalization fails.
 */
export function buildPhoneIdentity(params: BuildPhoneIdentityParams): HashedPhoneResult {
  const raw = typeof params.rawPhone === 'string' ? params.rawPhone.trim().slice(0, 64) : '';
  if (!raw) {
    return { raw: '', e164: null, hash: null, reason: 'empty_input' };
  }

  const iso = (params.countryIso ?? '').trim() || 'TR';
  const e164 = normalizeToE164(raw, iso);
  if (!e164) {
    return { raw, e164: null, hash: null, reason: 'normalization_failed' };
  }

  const salt = resolvePhoneHashSalt(params.salt);

  try {
    const hash = hashPhoneForEC(e164, salt);
    return { raw, e164, hash, reason: 'ok' };
  } catch {
    return { raw, e164, hash: null, reason: 'hash_failed' };
  }
}
