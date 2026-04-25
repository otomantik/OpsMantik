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
import { RateLimitService } from '@/lib/services/rate-limit-service';

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
  req: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const rateLimit = await RateLimitService.checkWithMode(
      `tracker-embed:${RateLimitService.getClientId(req)}`,
      60,
      60_000,
      { namespace: 'tracker_embed', mode: 'fail-closed', fallbackMaxRequests: 15 }
    );
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

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

    const { data: siteRow, error: siteRowErr } = await supabase
      .from('sites')
      .select('public_id, domain')
      .eq('id', site.id)
      .maybeSingle();
    if (siteRowErr || !siteRow?.public_id) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    const sitePublicId = siteRow.public_id;
    const normalizedDomain = typeof siteRow.domain === 'string' ? siteRow.domain.trim().toLowerCase() : '';
    const proxyUrl = normalizedDomain ? `https://${normalizedDomain}/opsmantik/call-event` : null;
    const requestUrl = new URL(req.url);
    const requestedMode = requestUrl.searchParams.get('mode');
    const mode = requestedMode === 'signed'
      ? 'signed'
      : requestedMode === 'proxy'
        ? 'proxy'
        : proxyUrl
          ? 'proxy'
          : 'signed';

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
        p_site_public_id: sitePublicId,
        p_current_secret: newSecret,
        p_next_secret: null,
      });
      if (rotErr) {
        return NextResponse.json(
          {
            error: 'Secret not provisioned',
            hint: 'Run: node scripts/get-tracker-embed.mjs ' + sitePublicId,
          },
          { status: 503 }
        );
      }
      secret = newSecret;
    }

    const proxyScriptTag = `<script defer src="${CONSOLE_ORIGIN}/assets/core.js?v=4" data-ops-site-id="${sitePublicId}" data-ops-consent="analytics" data-api="${CONSOLE_ORIGIN}/api/sync"${proxyUrl ? ` data-ops-proxy-url="${proxyUrl}"` : ''}></script>`;
    const signedScriptTag = `<script defer src="${CONSOLE_ORIGIN}/assets/core.js?v=4" data-ops-site-id="${sitePublicId}" data-ops-secret="${secret}" data-ops-consent="analytics" data-api="${CONSOLE_ORIGIN}/api/sync"></script>`;

    return NextResponse.json({
      scriptTag: mode === 'signed' ? signedScriptTag : proxyScriptTag,
      proxyScriptTag,
      signedScriptTag,
      siteId: sitePublicId,
      mode,
      note:
        mode === 'signed'
          ? (proxyUrl
            ? 'Signed mode includes data-ops-secret. Prefer proxy mode in production.'
            : 'Signed mode selected automatically because proxy endpoint is unavailable for this site.')
          : 'Proxy mode enabled. Configure /opsmantik/call-event endpoint on your site for call-event forwarding.',
    });
  } catch (e) {
    console.error('[tracker-embed]', e);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
