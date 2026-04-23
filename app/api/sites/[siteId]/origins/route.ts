import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { RateLimitService } from '@/lib/services/rate-limit-service';

function normalizeOrigin(raw: string): string {
  return new URL(raw).origin.toLowerCase();
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
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

  const { data, error } = await adminClient
    .from('site_allowed_origins')
    .select('origin, status, verification_state, updated_at')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ origins: data || [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const rateLimit = await RateLimitService.checkWithMode(
    `site-origin-create:${RateLimitService.getClientId(req)}`,
    20,
    60_000,
    { namespace: 'site_origin_create', mode: 'fail-closed', fallbackMaxRequests: 5 }
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
  const rawOrigin = typeof body.origin === 'string' ? body.origin.trim() : '';
  if (!rawOrigin) {
    return NextResponse.json({ error: 'origin required' }, { status: 400 });
  }

  let normalizedOrigin = '';
  try {
    normalizedOrigin = normalizeOrigin(rawOrigin);
  } catch {
    return NextResponse.json({ error: 'Invalid origin format' }, { status: 400 });
  }

  const { error } = await adminClient.from('site_allowed_origins').upsert(
    {
      site_id: siteId,
      origin: normalizedOrigin,
      status: 'active',
      verification_state: 'pending',
    },
    { onConflict: 'site_id,origin' }
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, origin: normalizedOrigin });
}
