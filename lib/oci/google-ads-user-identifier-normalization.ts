/**
 * Google Ads Enhanced Conversions — user identifier normalization (SHA-256).
 * Never log raw inputs from this module in production diagnostics.
 *
 * Phone hashing aligns with `@/lib/oci/validation/crypto` (PR-9H.7A):
 * normalized E.164 **with '+'** → UTF-8 SHA-256 lowercase hex — no salt.
 */

import {
  EC_PHONE_HASH_NORMALIZATION_VERSION,
  hashNormalizedEmail,
  hashPhoneSha256E164,
} from '@/lib/oci/validation/crypto';

export const GOOGLE_ADS_USER_ID_NORMALIZATION_VERSION = 'google_ads_sha256_v1';

/** @deprecated Prefer `normalizePhoneToE164` / crypto SSOT; kept for tests and legacy callers. */
export function normalizePhoneForGoogleAds(phone: string, defaultCountryCallingCode?: string): string {
  const s = String(phone || '').trim();
  if (!s) return '';
  const hasPlus = s.startsWith('+');
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';

  if (hasPlus) {
    return `+${digits}`;
  }

  const cc = (defaultCountryCallingCode || '').replace(/\D/g, '');
  if (cc && digits.length >= 8 && digits.length <= 15) {
    if (!digits.startsWith(cc)) {
      return `+${cc}${digits}`;
    }
  }

  return `+${digits}`;
}

/**
 * Email: trim, lowercase, remove internal whitespace per common EC guidance.
 */
export function normalizeEmailForGoogleAds(email: string): string {
  const trimmed = String(email || '').trim().toLowerCase();
  return trimmed.replace(/\s+/g, '');
}

export type BuildUserIdentifiersInput = {
  email?: string | null;
  phone?: string | null;
  /** E.164 country calling code without +, e.g. "90" for TR — maps to ISO for crypto when needed */
  defaultCountryCallingCode?: string;
  /** ISO 3166-1 alpha-2 — preferred when set (defaults TR when phone resolves via `90`). */
  defaultCountryIso?: string;
  consentUserIdentifiers: boolean;
};

export type BuildUserIdentifiersResult = {
  userIdentifiers: {
    hashed_email?: string;
    hashed_phone?: string;
    normalization_version: string;
    consent: { user_identifiers: boolean };
  } | null;
  skippedReason: 'CONSENT_MISSING' | 'NO_INPUT' | null;
};

function countryIsoFromCallingCode(cc: string | undefined): string | undefined {
  const d = String(cc ?? '').replace(/\D/g, '');
  if (d === '90') return 'TR';
  if (d === '1') return 'US';
  if (d === '44') return 'GB';
  return undefined;
}

/**
 * Returns hashed payload suitable for `offline_conversion_queue.user_identifiers` or null when gated.
 */
export function buildGoogleAdsUserIdentifiers(input: BuildUserIdentifiersInput): BuildUserIdentifiersResult {
  if (!input.consentUserIdentifiers) {
    return { userIdentifiers: null, skippedReason: 'CONSENT_MISSING' };
  }

  const emailNorm = input.email ? normalizeEmailForGoogleAds(input.email) : '';
  let phoneHashHex: string | null = null;
  if (input.phone) {
    try {
      const iso =
        (input.defaultCountryIso ?? '').trim().toUpperCase().slice(0, 2) ||
        countryIsoFromCallingCode(input.defaultCountryCallingCode) ||
        'TR';
      phoneHashHex = hashPhoneSha256E164(input.phone, { defaultCountryIso: iso });
    } catch {
      phoneHashHex = null;
    }
  }

  if (!emailNorm && !phoneHashHex) {
    return { userIdentifiers: null, skippedReason: 'NO_INPUT' };
  }

  const emailHashHex = emailNorm ? hashNormalizedEmail(emailNorm) : null;

  const normalizationVersion =
    phoneHashHex && !emailHashHex
      ? EC_PHONE_HASH_NORMALIZATION_VERSION
      : phoneHashHex && emailHashHex
        ? EC_PHONE_HASH_NORMALIZATION_VERSION
        : GOOGLE_ADS_USER_ID_NORMALIZATION_VERSION;

  const out: {
    hashed_email?: string;
    hashed_phone?: string;
    normalization_version: string;
    consent: { user_identifiers: boolean };
  } = {
    normalization_version: normalizationVersion,
    consent: { user_identifiers: true },
  };

  if (emailHashHex) out.hashed_email = emailHashHex;
  if (phoneHashHex) out.hashed_phone = phoneHashHex;

  return { userIdentifiers: out, skippedReason: null };
}
