import { adminClient } from '@/lib/supabase/admin';
import { isOriginAllowed, parseAllowedOrigins } from '@/lib/security/cors';

function safeNormalizeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

export async function isAllowedOriginForSite(siteId: string, origin: string | null): Promise<boolean> {
  const normalized = safeNormalizeOrigin(origin);
  if (!normalized) return false;

  const { data, error } = await adminClient
    .from('site_allowed_origins')
    .select('origin, status')
    .eq('site_id', siteId)
    .eq('status', 'active');

  if (!error && Array.isArray(data) && data.length > 0) {
    const allowedOrigins = data
      .map((row) => safeNormalizeOrigin(typeof row.origin === 'string' ? row.origin : null))
      .filter((value): value is string => Boolean(value));
    const { isAllowed } = isOriginAllowed(normalized, allowedOrigins);
    return isAllowed;
  }

  // Emergency fallback for legacy environments still using env-only origin control.
  const fallbackOrigins = parseAllowedOrigins();
  const fallbackDecision = isOriginAllowed(normalized, fallbackOrigins);
  return fallbackDecision.isAllowed;
}
