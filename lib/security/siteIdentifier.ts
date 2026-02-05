export const SITE_PUBLIC_ID_RE = /^[a-f0-9]{32}$/i;
export const SITE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidSiteIdentifier(input: string): boolean {
  const s = (input || '').trim();
  if (!s) return false;
  return SITE_PUBLIC_ID_RE.test(s) || SITE_UUID_RE.test(s);
}

