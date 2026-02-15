/**
 * POST /api/providers/credentials/test — verify stored credentials (decrypt server-side, call provider.verifyCredentials).
 * Auth: validateSiteAccess(site_id). Body: site_id, provider_key.
 * Response: { ok: true } or error from provider. PR-G1: Vault credentials.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { adminClient } from '@/lib/supabase/admin';
import { decryptJson } from '@/lib/security/vault';
import { getProvider } from '@/lib/providers/registry';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { ProviderAuthError, ProviderValidationError } from '@/lib/providers/errors';

export const runtime = 'nodejs';

const HEADERS = () => getBuildInfoHeaders();

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: HEADERS() });
  }

  let body: { site_id?: string; provider_key?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: HEADERS() });
  }

  const siteId = body.site_id;
  const providerKey = body.provider_key;

  if (!siteId || typeof siteId !== 'string') {
    return NextResponse.json({ error: 'site_id is required' }, { status: 400, headers: HEADERS() });
  }
  if (!providerKey || typeof providerKey !== 'string') {
    return NextResponse.json({ error: 'provider_key is required' }, { status: 400, headers: HEADERS() });
  }

  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: HEADERS() });
  }

  const { data: row, error: fetchError } = await adminClient
    .from('provider_credentials')
    .select('encrypted_payload')
    .eq('site_id', siteId)
    .eq('provider_key', providerKey)
    .eq('is_active', true)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json(
      { error: fetchError.message ?? 'Failed to load credentials' },
      { status: 500, headers: HEADERS() }
    );
  }
  if (!row?.encrypted_payload) {
    return NextResponse.json(
      { error: 'No credentials found for this site and provider' },
      { status: 404, headers: HEADERS() }
    );
  }

  let creds: unknown;
  try {
    creds = await decryptJson(row.encrypted_payload as string);
  } catch (err) {
    console.error('[vault] decrypt failed:', err);
    return NextResponse.json(
      { error: 'Decryption failed. Key may have rotated.' },
      { status: 500, headers: HEADERS() }
    );
  }

  const adapter = getProvider(providerKey);
  try {
    await adapter.verifyCredentials(creds);
  } catch (err) {
    if (err instanceof ProviderAuthError) {
      return NextResponse.json(
        { error: 'Invalid credentials', code: 'PROVIDER_AUTH_ERROR' },
        { status: 401, headers: HEADERS() }
      );
    }
    if (err instanceof ProviderValidationError) {
      return NextResponse.json(
        { error: err.message, code: 'PROVIDER_VALIDATION' },
        { status: 400, headers: HEADERS() }
      );
    }
    throw err;
  }

  return NextResponse.json({ ok: true }, { status: 200, headers: HEADERS() });
}
