import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { PanelFeed } from '../../components/dashboard/panel-feed';
import { logError } from '@/lib/logging/logger';
import { getTodayTrtUtcRange, resolveDashboardUiTimezone } from '@/lib/time/today-range';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { SiteLocaleProvider } from '@/components/context/site-locale-context';
import { resolveLocale } from '@/lib/i18n/locale';
import { translate } from '@/lib/i18n/t';
import { LogOut } from 'lucide-react';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import {
  getPanelPreviewCookieName,
  verifyPanelPreviewContext,
} from '@/lib/auth/panel-preview-context';
import { resolvePlatformAdmin } from '@/lib/auth/platform-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PanelRouteProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PanelRoute({ searchParams }: PanelRouteProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const [headersList, cookieStore] = await Promise.all([headers(), cookies()]);
  const acceptLanguage = headersList.get('accept-language') ?? null;
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value ?? null;
  const baseLocale = resolveLocale(null, user?.user_metadata, acceptLanguage, cookieLocale);

  const sp = (await searchParams) || {};
  const requestedSiteIdRaw = Array.isArray(sp.siteId) ? sp.siteId[0] : sp.siteId;
  const requestedSiteId = typeof requestedSiteIdRaw === 'string' && requestedSiteIdRaw.trim()
    ? requestedSiteIdRaw.trim()
    : null;
  const previewModeRaw = Array.isArray(sp.preview) ? sp.preview[0] : sp.preview;
  const wantsPreviewMode = previewModeRaw === 'customer';

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const isPlatformAdmin = resolvePlatformAdmin(profile?.role ?? null, user);

  // Find user's site
  let targetSiteId: string | null = null;
  let isReadOnlyPreview = false;
  const previewToken = cookieStore.get(getPanelPreviewCookieName())?.value ?? '';
  const previewContext = previewToken ? await verifyPanelPreviewContext(previewToken) : null;

  if (requestedSiteId) {
    const access = await validateSiteAccess(requestedSiteId, user.id, supabase);
    if (access.allowed) {
      targetSiteId = requestedSiteId;
      const previewValid =
        Boolean(previewContext) &&
        previewContext?.siteId === requestedSiteId &&
        previewContext?.userId === user.id &&
        previewContext?.scope === 'ro' &&
        isPlatformAdmin;
      if (wantsPreviewMode && previewValid) {
        isReadOnlyPreview = true;
      }
    }
  }

  if (!targetSiteId) {
  const { data: ownedSite } = await adminClient
    .from('sites')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (ownedSite) {
    targetSiteId = ownedSite.id;
  } else {
    const { data: membership } = await adminClient
      .from('site_memberships')
      .select('site_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (membership) {
      targetSiteId = membership.site_id;
    }
  }
  }

  if (!targetSiteId) {
    // Final fallback: first readable site under current RLS context.
    const { data: readableSite } = await supabase
      .from('sites')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (readableSite?.id) {
      targetSiteId = readableSite.id;
    }
  }

  if (!targetSiteId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white text-slate-500">
        <h1 className="text-xl font-black text-slate-900 mb-2">{translate(baseLocale, 'panel.unauthorizedTitle')}</h1>
        <p className="text-sm">{translate(baseLocale, 'panel.unauthorizedDescription')}</p>
      </div>
    );
  }

  const { data: site } = await adminClient
    .from('sites')
    .select('name, locale, currency, timezone')
    .eq('id', targetSiteId)
    .single();

  const resolvedLocale = resolveLocale(site, user?.user_metadata, acceptLanguage, cookieLocale);

  // Fetch via RPC
  const panelTimezone = resolveDashboardUiTimezone(site?.timezone ?? null, resolvedLocale);
  const isTrLocale = resolvedLocale.toLowerCase().startsWith('tr');
  const rawCur = (site?.currency ?? '').toString().trim();
  const panelCurrency = rawCur || (isTrLocale ? 'TRY' : 'USD');
  // Deck visibility is "today/yesterday" in `PanelFeed`, but the panel bootstrap
  // previously fetched only the "today" window. If intents were created in the
  // tail of "yesterday" (timezone offset crossing), the UI could show an empty
  // deck until the next boot/re-fetch. Fetch a 48h window covering both buckets.
  const now = new Date();
  const todayRange = getTodayTrtUtcRange(now, panelTimezone);
  const yesterdayRange = getTodayTrtUtcRange(new Date(now.getTime() - 24 * 60 * 60 * 1000), panelTimezone);
  const fromIso = yesterdayRange.fromIso;
  const toIso = todayRange.toIso;
  const { data: calls, error: callsError } = await adminClient.rpc('get_recent_intents_lite_v1', {
    p_site_id: targetSiteId,
    p_date_from: fromIso,
    p_date_to: toIso,
    p_limit: 50,
    p_ads_only: false
  });

  if (callsError) {
    logError('Panel RPC fetch failed', { error: callsError.message });
  }

  const processedCalls = (calls || []).filter((c: import('@/lib/types/hunter').HunterIntent) => {
    const s = (c.status || '').toLowerCase();
    if (s === 'confirmed' || s === 'junk' || s === 'g_trash') return false;
    return true;
  });
  const dedupedProcessedCalls = processedCalls.filter((
    call: import('@/lib/types/hunter').HunterIntent,
    index: number,
    arr: import('@/lib/types/hunter').HunterIntent[]
  ) => {
    const sid =
      typeof call.matched_session_id === 'string' && call.matched_session_id.trim()
        ? call.matched_session_id.trim()
        : null;
    if (!sid) return true;
    return (
      arr.findIndex(
        (x: import('@/lib/types/hunter').HunterIntent) =>
          typeof x.matched_session_id === 'string' &&
          x.matched_session_id.trim() &&
          x.matched_session_id.trim() === sid
      ) === index
    );
  });

  return (
    <I18nProvider
      locale={resolvedLocale}
      siteConfig={{ currency: panelCurrency, timezone: panelTimezone }}
    >
      <SiteLocaleProvider
        value={{ timezone: panelTimezone, currency: panelCurrency, locale: resolvedLocale }}
      >
      <div className="min-h-screen bg-slate-50 font-sans">
        {/* Top Bar (Light) */}
        <div className="border-b border-slate-100 bg-white/80 backdrop-blur-md sticky top-0 z-40 transition-all">
          <div className="max-w-xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center shadow-lg shadow-slate-900/10">
                <span className="text-[10px] font-black text-white tracking-widest">
                  {translate(resolvedLocale, 'panel.brandMonogram')}
                </span>
              </div>
              <div>
                <div className="text-sm font-black text-slate-900 leading-none">{site?.name || 'OpsMantik'}</div>
                <div className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 mt-1">
                  {translate(resolvedLocale, 'panel.focusDeck')}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full border border-emerald-100">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[9px] font-black text-emerald-700 uppercase tracking-widest leading-none">
                  {translate(resolvedLocale, 'panel.live')}
                </span>
              </div>
              {isReadOnlyPreview && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 rounded-full border border-amber-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span className="text-[9px] font-black text-amber-700 uppercase tracking-widest leading-none">
                    read-only preview
                  </span>
                </div>
              )}
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md border border-slate-200 bg-white text-[10px] font-black uppercase tracking-wide text-slate-600 hover:bg-slate-50 hover:text-red-600"
                  title={translate(resolvedLocale, 'dashboard.signOut')}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {translate(resolvedLocale, 'dashboard.signOut')}
                </button>
              </form>
            </div>
          </div>
        </div>
        {/* Surface */}
        <div className="max-w-xl mx-auto px-4 py-8">
          <PanelFeed
            siteId={targetSiteId}
            initialCalls={dedupedProcessedCalls as unknown as import('@/lib/types/hunter').HunterIntent[]}
            readOnly={isReadOnlyPreview}
          />
        </div>
      </div>
      </SiteLocaleProvider>
    </I18nProvider>
  );
}
