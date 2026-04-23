import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { logInfo } from '@/lib/logging/logger';

function normalizeOrigin(raw: string): string {
  return new URL(raw).origin.toLowerCase();
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const rateLimit = await RateLimitService.checkWithMode(
    `site-origin-verify:${RateLimitService.getClientId(req)}`,
    15,
    60_000,
    { namespace: 'site_origin_verify', mode: 'fail-closed', fallbackMaxRequests: 5 }
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
  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const bodyUnknown = await req.json().catch(() => ({}));
  const body =
    bodyUnknown && typeof bodyUnknown === 'object' && !Array.isArray(bodyUnknown)
      ? (bodyUnknown as Record<string, unknown>)
      : {};

  const token = typeof body.token === 'string' ? body.token : '';
  const expectedToken = process.env.SITE_ORIGIN_VERIFY_TOKEN;
  if (!expectedToken || token !== expectedToken) {
    return NextResponse.json({ error: 'Verification token mismatch' }, { status: 403 });
  }

  const rawOrigin = typeof body.origin === 'string' ? body.origin.trim() : '';
  if (!rawOrigin) {
    return NextResponse.json({ error: 'origin required' }, { status: 400 });
  }

  let origin = '';
  try {
    origin = normalizeOrigin(rawOrigin);
  } catch {
    return NextResponse.json({ error: 'Invalid origin format' }, { status: 400 });
  }

  const { error } = await adminClient
    .from('site_allowed_origins')
    .update({
      status: 'active',
      verification_state: 'verified',
      updated_at: new Date().toISOString(),
    })
    .eq('site_id', siteId)
    .eq('origin', origin);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logInfo('SITE_ORIGIN_VERIFIED', { user_id: user.id, site_id: siteId, route: '/api/sites/[siteId]/origins/verify' });
  return NextResponse.json({ success: true });
}
