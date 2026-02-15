/**
 * POST /api/providers/credentials — save or update encrypted provider credentials for a site.
 * Auth: validateSiteAccess(site_id). Body: site_id, provider_key, credentials_json.
 * Response: { ok: true }. Never returns encrypted_payload.
 * PR-G1: Vault credentials.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { encryptJson } from '@/lib/security/vault';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { getProvider } from '@/lib/providers/registry';

export const runtime = 'nodejs';

const HEADERS = () => getBuildInfoHeaders();

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: HEADERS() });
  }

  let body: { site_id?: string; provider_key?: string; credentials_json?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: HEADERS() });
  }

  const siteId = body.site_id;
  const providerKey = body.provider_key;
  const credentialsJson = body.credentials_json;

  if (!siteId || typeof siteId !== 'string') {
    return NextResponse.json({ error: 'site_id is required' }, { status: 400, headers: HEADERS() });
  }
  if (!providerKey || typeof providerKey !== 'string') {
    return NextResponse.json({ error: 'provider_key is required' }, { status: 400, headers: HEADERS() });
  }
  if (credentialsJson === undefined) {
    return NextResponse.json({ error: 'credentials_json is required' }, { status: 400, headers: HEADERS() });
  }

  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: HEADERS() });
  }

  try {
    getProvider(providerKey);
  } catch {
    return NextResponse.json({ error: 'Unsupported provider_key' }, { status: 400, headers: HEADERS() });
  }

  let ciphertext: string;
  let keyFingerprint: string;
  try {
    const result = await encryptJson(credentialsJson);
    ciphertext = result.ciphertext;
    keyFingerprint = result.key_fingerprint;
  } catch (err) {
    console.error('[vault] encrypt failed:', err);
    return NextResponse.json(
      { error: 'Encryption failed. Check OPSMANTIK_VAULT_KEY.' },
      { status: 500, headers: HEADERS() }
    );
  }

  const { error: upsertError } = await supabase
    .from('provider_credentials')
    .upsert(
      {
        site_id: siteId,
        provider_key: providerKey,
        encrypted_payload: ciphertext,
        key_fingerprint: keyFingerprint,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'site_id,provider_key' }
    );

  if (upsertError) {
    return NextResponse.json(
      { error: upsertError.message ?? 'Failed to save credentials' },
      { status: 500, headers: HEADERS() }
    );
  }

  return NextResponse.json({ ok: true }, { status: 200, headers: HEADERS() });
}
