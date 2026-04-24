import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { resolvePlatformAdmin } from '@/lib/auth/platform-admin';
import {
  getPanelPreviewCookieName,
  getPanelPreviewTtlSeconds,
  signPanelPreviewContext,
} from '@/lib/auth/panel-preview-context';

export const dynamic = 'force-dynamic';

function buildPanelUrl(request: NextRequest, siteId: string): URL {
  const url = new URL('/panel', request.url);
  url.searchParams.set('siteId', siteId);
  url.searchParams.set('preview', 'customer');
  return url;
}

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get('siteId');
  const modeRaw = (request.nextUrl.searchParams.get('mode') || '').trim().toLowerCase();
  const scope: 'ro' | 'rw' = modeRaw === 'ro' ? 'ro' : 'rw';
  if (!siteId) {
    return NextResponse.redirect(new URL('/admin/sites?error=missing_site', request.url));
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const isPlatformAdmin = resolvePlatformAdmin(profile?.role ?? null, user);
  if (!isPlatformAdmin) {
    return NextResponse.redirect(new URL('/panel?error=admin_required', request.url));
  }

  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed) {
    return NextResponse.redirect(new URL('/panel?error=site_access_denied', request.url));
  }

  const token = await signPanelPreviewContext({
    userId: user.id,
    siteId,
    scope,
  });

  const response = NextResponse.redirect(buildPanelUrl(request, siteId));
  response.cookies.set(getPanelPreviewCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: getPanelPreviewTtlSeconds(),
  });
  return response;
}
