/**
 * GET /api/sites/[siteId]/tracker-embed
 * Returns the full tracker script tag including data-ops-secret so call-event (phone/WhatsApp) is sent.
 * Auth: Bearer + validateSiteAccess. Only site owner/members can read the secret.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { SiteService } from '@/lib/services/site-service';
import { randomBytes } from 'node:crypto';

export const dynamic = 'force-dynamic';

const CONSOLE_ORIGIN =
  process.env.NEXT_PUBLIC_PRIMARY_DOMAIN
    ? `https://console.${process.env.NEXT_PUBLIC_PRIMARY_DOMAIN}`
    : process.env.NEXT_PUBLIC_APP_URL || 'https://console.opsmantik.com';

function getPrivateClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, {
    auth: { persistSession: false },
    schema: 'private',
  } as { auth: { persistSession: boolean }; schema: string });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { siteId } = await params;
    if (!siteId) {
      return NextResponse.json({ error: 'Missing siteId' }, { status: 400 });
    }

    const { valid, site } = await SiteService.validateSite(siteId);
    if (!valid || !site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const access = await validateSiteAccess(site.id, user.id, supabase);
    if (!access.allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const privateClient = getPrivateClient();
    if (!privateClient) {
      return NextResponse.json(
        { error: 'Server misconfiguration' },
        { status: 500 }
      );
    }

    type SecretsRow = { current_secret: string | null; next_secret: string | null };
    const secretsResult = await privateClient.rpc('get_site_secrets', {
      p_site_id: site.id,
    });
    const secretsData = Array.isArray(secretsResult.data)
      ? (secretsResult.data as SecretsRow[])
      : null;
    const secretsErr = secretsResult.error;

    let secret: string | null = null;
    if (!secretsErr && Array.isArray(secretsData) && secretsData.length > 0) {
      const row = secretsData[0];
      secret = row?.current_secret ?? null;
    }

    if (!secret || secret.length < 16) {
      const { adminClient } = await import('@/lib/supabase/admin');
      const newSecret = randomBytes(32).toString('base64url');
      const { error: rotErr } = await adminClient.rpc('rotate_site_secret_v1', {
        p_site_public_id: site.public_id,
        p_current_secret: newSecret,
        p_next_secret: null,
      });
      if (rotErr) {
        return NextResponse.json(
          {
            error: 'Secret not provisioned',
            hint: 'Run: node scripts/get-tracker-embed.mjs ' + site.public_id,
          },
          { status: 503 }
        );
      }
      secret = newSecret;
    }

    const scriptTag = `<script defer src="${CONSOLE_ORIGIN}/assets/core.js?v=4" data-ops-site-id="${site.public_id}" data-ops-secret="${secret}" data-ops-consent="analytics" data-api="${CONSOLE_ORIGIN}/api/sync"></script>`;

    return NextResponse.json({
      scriptTag,
      siteId: site.public_id,
      note: 'Include data-ops-secret so phone/WhatsApp clicks send call-event to OpsMantik.',
    });
  } catch (e) {
    console.error('[tracker-embed]', e);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
