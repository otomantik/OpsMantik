/**
 * POST /api/cron/providers/seed-credentials — upsert provider_credentials for a site (staging/testing only).
 * Auth: requireCronAuth. Body: { site_id: string, provider_key: string, credentials: object }.
 * Encrypts credentials with vault and upserts. Runbook: lock or remove in production.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';
import { encryptJson } from '@/lib/security/vault';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { ok: false, error: 'Seed credentials disabled in production' },
      { status: 403, headers: getBuildInfoHeaders() }
    );
  }
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;

  let body: { site_id?: string; provider_key?: string; credentials?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400, headers: getBuildInfoHeaders() }
    );
  }

  const siteId = body.site_id?.trim();
  const providerKey = body.provider_key?.trim() || 'google_ads';
  const credentials = body.credentials;

  if (!siteId || typeof credentials !== 'object' || credentials === null) {
    return NextResponse.json(
      { ok: false, error: 'Missing site_id or credentials object' },
      { status: 400, headers: getBuildInfoHeaders() }
    );
  }

  try {
    const { ciphertext, key_fingerprint } = await encryptJson(credentials);

    const { error } = await adminClient
      .from('provider_credentials')
      .upsert(
        {
          site_id: siteId,
          provider_key: providerKey,
          encrypted_payload: ciphertext,
          key_fingerprint,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'site_id,provider_key' }
      );

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    return NextResponse.json(
      { ok: true, site_id: siteId, provider_key: providerKey },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}
