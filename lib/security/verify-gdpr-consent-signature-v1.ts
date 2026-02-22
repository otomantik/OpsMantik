/**
 * GDPR consent signature verification.
 * Uses DB RPC; does NOT reuse verify_call_event_signature_v1.
 * Payload: ts|nonce|site_id|identifier_type|identifier_value|scopes_json|consent_at
 * Replay protection: ts within 5 min.
 */
import { createClient } from '@supabase/supabase-js';

export type VerifyConsentParams = {
  siteId: string;
  ts: number;
  nonce: string;
  identifierType: string;
  identifierValue: string;
  consentScopesJson: string;
  consentAt: string;
  signature: string;
};

export async function verifyGdprConsentSignatureV1(
  supabaseUrl: string,
  anonKey: string,
  params: VerifyConsentParams
): Promise<boolean> {
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.rpc('verify_gdpr_consent_signature_v1', {
    p_site_public_id: params.siteId,
    p_ts: params.ts,
    p_nonce: params.nonce,
    p_identifier_type: params.identifierType,
    p_identifier_value: params.identifierValue,
    p_consent_scopes_json: params.consentScopesJson,
    p_consent_at: params.consentAt,
    p_signature: params.signature,
  });
  if (error) return false;
  return data === true;
}
