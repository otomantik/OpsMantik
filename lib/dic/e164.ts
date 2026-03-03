/**
 * DIC / Enhanced Conversions: E.164 phone normalization.
 * Uses UTF-8 only; country_iso drives the default calling code when raw has no +prefix.
 */

/** ISO 3166-1 alpha-2 to country calling code (no +). */
const COUNTRY_CALLING_CODE: Record<string, string> = {
  TR: '90',
  US: '1',
  GB: '44',
  DE: '49',
  FR: '33',
  NL: '31',
  ES: '34',
  IT: '39',
  SA: '966',
  AE: '971',
  AZ: '994',
  RU: '7',
  UA: '380',
  PL: '48',
  RO: '40',
  GR: '30',
  PT: '351',
  BE: '32',
  AT: '43',
  CH: '41',
  SE: '46',
  NO: '47',
  DK: '45',
  FI: '358',
  IE: '353',
  IN: '91',
  PK: '92',
  EG: '20',
  NG: '234',
  ZA: '27',
  BR: '55',
  MX: '52',
  AR: '54',
  CL: '56',
  CO: '57',
  AU: '61',
  JP: '81',
  CN: '86',
  KR: '82',
  SG: '65',
  MY: '60',
  TH: '66',
  ID: '62',
  PH: '63',
  VN: '84',
};

/**
 * Normalize a raw phone string to E.164 using country context.
 * Input is interpreted as UTF-8; output is digits only.
 *
 * @param rawPhone - Verbatim phone (may include spaces, dashes, leading 0, tel: prefix)
 * @param countryIso - ISO 3166-1 alpha-2 (e.g. TR, US) for default calling code
 * @returns E.164 string (e.g. "905321234567") or null if not normalizable
 */
export function normalizeToE164(rawPhone: string, countryIso: string): string | null {
  if (typeof rawPhone !== 'string' || typeof countryIso !== 'string') return null;
  const trimmed = rawPhone.trim();
  if (!trimmed.length) return null;

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length < 7) return null;

  const upperIso = countryIso.toUpperCase().slice(0, 2);
  const countryCode = COUNTRY_CALLING_CODE[upperIso] ?? null;

  let e164: string;
  if (trimmed.startsWith('+')) {
    e164 = digitsOnly;
  } else if (countryCode && (digitsOnly.startsWith(countryCode) || !digitsOnly.startsWith('0'))) {
    const local = digitsOnly.startsWith(countryCode) ? digitsOnly : digitsOnly.replace(/^0+/, '');
    e164 = local.startsWith(countryCode) ? local : countryCode + local;
  } else if (digitsOnly.startsWith('0')) {
    const local = digitsOnly.replace(/^0+/, '');
    if (!countryCode || local.length < 7) return null;
    // Avoid double country code (e.g. 0090 532... -> 905321234567, not 90905321234567)
    e164 = local.startsWith(countryCode) ? local : countryCode + local;
  } else if (countryCode) {
    e164 = digitsOnly.startsWith(countryCode) ? digitsOnly : countryCode + digitsOnly;
  } else {
    e164 = digitsOnly.length >= 10 ? digitsOnly : digitsOnly;
    if (e164.length < 10) return null;
  }

  return e164.length >= 10 && e164.length <= 15 ? e164 : null;
}
