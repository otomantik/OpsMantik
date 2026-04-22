import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { PanelFeed } from '../../components/dashboard/panel-feed';
import { logError } from '@/lib/logging/logger';
import { getTodayTrtUtcRange, resolveDashboardDayTimezone } from '@/lib/time/today-range';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { resolveLocale } from '@/lib/i18n/locale';
import { translate } from '@/lib/i18n/t';
import { LogOut } from 'lucide-react';
import { isAdmin } from '@/lib/auth/is-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function PanelRoute() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const userIsAdmin = await isAdmin();
  if (userIsAdmin) {
    redirect('/dashboard');
  }

  const [headersList, cookieStore] = await Promise.all([headers(), cookies()]);
  const acceptLanguage = headersList.get('accept-language') ?? null;
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value ?? null;
  const baseLocale = resolveLocale(null, user?.user_metadata, acceptLanguage, cookieLocale);

  // Find user's site
  let targetSiteId: string | null = null;
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
  const panelTimezone = resolveDashboardDayTimezone(site?.timezone ?? null);
  const { fromIso, toIso } = getTodayTrtUtcRange(new Date(), panelTimezone);
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

  return (
    <I18nProvider
      locale={resolvedLocale}
      siteConfig={{ currency: site?.currency ?? undefined, timezone: site?.timezone ?? undefined }}
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
            initialCalls={processedCalls as unknown as import('@/lib/types/hunter').HunterIntent[]}
          />
        </div>
      </div>
    </I18nProvider>
  );
}
