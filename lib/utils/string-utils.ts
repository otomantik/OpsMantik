/**
 * Turkish character encoding utilities for Hunter Terminal.
 * Fixes double-encoding and URL-decodes UTM/URL-derived text safely.
 */

/** Pairs of double-encoded (UTF-8 read as Latin-1) → correct Turkish character */
const DOUBLE_ENCODING_FIXES: [string, string][] = [
  ['Ã‡', 'Ç'],
  ['Ã§', 'ç'],
  ['Äž', 'Ğ'],
  ['ÄŸ', 'ğ'],
  ['Ä°', 'İ'],
  ['Ä±', 'ı'],
  ['Ã–', 'Ö'],
  ['Ã¶', 'ö'],
  ['Åž', 'Ş'],
  ['ÅŸ', 'ş'],
  ['Ãœ', 'Ü'],
  ['Ã¼', 'ü'],
];

function fixDoubleEncoding(str: string): string {
  let out = str;
  for (const [from, to] of DOUBLE_ENCODING_FIXES) {
    out = out.split(from).join(to);
  }
  return out;
}

/**
 * Safely decode URL/UTM-derived text for display.
 * - null/undefined → ""
 * - Replaces "+" with space (application/x-www-form-urlencoded)
 * - Tries decodeURIComponent; on error returns original string
 * - Applies a secondary pass to fix common double-encoding artifacts (e.g. Ã‡ → Ç, Ä± → ı)
 */
export function safeDecode(str: string | null | undefined): string {
  if (str == null) return '';
  const s = String(str).trim();
  if (!s) return '';
  const withSpaces = s.replace(/\+/g, ' ');
  let decoded: string;
  try {
    decoded = decodeURIComponent(withSpaces);
  } catch {
    return fixDoubleEncoding(withSpaces);
  }
  return fixDoubleEncoding(decoded);
}
