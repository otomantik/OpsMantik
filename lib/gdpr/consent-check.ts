/**
 * KVKK/GDPR: OCI enqueue marketing consent check.
 * marketing scope yoksa OCI enqueue yapılmaz.
 */

import { adminClient } from '@/lib/supabase/admin';

/**
 * Call için ilgili session'da marketing consent var mı?
 * Uses get_call_session_for_oci RPC (1 round-trip instead of 2).
 */
export async function hasMarketingConsentForCall(
  siteId: string,
  callId: string
): Promise<boolean> {
  const { data: rows, error } = await adminClient.rpc('get_call_session_for_oci', {
    p_call_id: callId,
    p_site_id: siteId,
  });
  if (error || !Array.isArray(rows) || rows.length === 0) return false;
  const row = rows[0] as { consent_scopes?: string[] | null };
  const scopes = (row.consent_scopes ?? []) as string[];
  return scopes.includes('marketing');
}
