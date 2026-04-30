import { createHash } from 'node:crypto';

export function normalizeEmailForHash(input: string | null | undefined): string | null {
  if (!input) return null;
  const out = input.trim().toLowerCase();
  return out.length > 0 ? out : null;
}

export function normalizePhoneToE164(
  input: string | null | undefined,
  defaultCountryCode = '+90'
): string | null {
  if (!input) return null;
  const digitsOnly = input.replace(/[^\d+]/g, '');
  if (!digitsOnly) return null;

  let normalized = digitsOnly;
  if (normalized.startsWith('00')) {
    normalized = `+${normalized.slice(2)}`;
  }
  if (!normalized.startsWith('+')) {
    normalized = normalized.replace(/^0+/, '');
    const countryDigits = defaultCountryCode.replace(/[^\d]/g, '');
    normalized = `+${countryDigits}${normalized}`;
  }

  normalized = `+${normalized.replace(/[^\d]/g, '')}`;
  // Common trunk-prefix cleanup: +90(0)5.. -> +905..
  const ccDigits = defaultCountryCode.replace(/[^\d]/g, '');
  if (ccDigits && normalized.startsWith(`+${ccDigits}0`)) {
    normalized = `+${ccDigits}${normalized.slice(ccDigits.length + 2)}`;
  }
  // E.164 max 15 digits (without +), min pragmatic 8
  const digitCount = normalized.slice(1).length;
  if (digitCount < 8 || digitCount > 15) return null;
  return normalized;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashNormalizedEmail(input: string | null | undefined): string | null {
  const normalized = normalizeEmailForHash(input);
  return normalized ? sha256Hex(normalized) : null;
}

export function hashNormalizedPhoneE164(
  input: string | null | undefined,
  defaultCountryCode = '+90'
): { e164: string; sha256: string } | null {
  const e164 = normalizePhoneToE164(input, defaultCountryCode);
  if (!e164) return null;
  return { e164, sha256: sha256Hex(e164) };
}
