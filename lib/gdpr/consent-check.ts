/**
 * KVKK/GDPR: OCI enqueue marketing consent check.
 * marketing scope yoksa OCI enqueue yapılmaz.
 */

import { adminClient } from '@/lib/supabase/admin';

/**
 * Call için ilgili session'da marketing consent var mı?
 * Call matched_session_id ile session'a bağlı.
 */
export async function hasMarketingConsentForCall(
  siteId: string,
  callId: string
): Promise<boolean> {
  const { data: call } = await adminClient
    .from('calls')
    .select('matched_session_id')
    .eq('id', callId)
    .eq('site_id', siteId)
    .maybeSingle();

  if (!call?.matched_session_id) return false;

  const { data: session } = await adminClient
    .from('sessions')
    .select('consent_scopes')
    .eq('id', call.matched_session_id)
    .eq('site_id', siteId)
    .maybeSingle();

  const scopes = (session?.consent_scopes ?? []) as string[];
  return scopes.includes('marketing');
}
