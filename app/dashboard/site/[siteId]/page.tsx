import { headers, cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { SiteLocaleProvider } from '@/components/context/site-locale-context';
import { isAdmin } from '@/lib/auth/is-admin';
import { panelSitePath } from '@/lib/auth/site-operational-route';
import { getTodayTrtUtcRange, resolveDashboardUiTimezone } from '@/lib/time/today-range';
import { resolveLocale } from '@/lib/i18n/locale';
import { translate } from '@/lib/i18n/t';
import type { Metadata } from 'next';
import type { SiteRole } from '@/lib/auth/rbac';
import { isOpsMantikModule } from '@/lib/types/modules';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';

// Canlıda eski HTML/JS cache'lenmesin; her istek güncel build ile dönsün.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SitePageProps {
  params: Promise<{ siteId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: SitePageProps): Promise<Metadata> {
  const { siteId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: site } = await supabase
    .from('sites')
    .select('name, domain, locale')
    .eq('id', siteId)
    .single();

  const [headersList, cookieStore] = await Promise.all([headers(), cookies()]);
  const acceptLanguage = headersList.get('accept-language') ?? null;
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value ?? null;
  const resolvedLocale = resolveLocale(site, user?.user_metadata, acceptLanguage, cookieLocale);

  const siteName = site?.name || site?.domain || 'OpsMantik';
  const metaTitle = translate(resolvedLocale, 'public.meta.title');
  const metaDesc = translate(resolvedLocale, 'public.meta.description');

  return {
    title: `${siteName} | ${metaTitle}`,
    description: metaDesc,
  };
}

export default async function SiteDashboardPage({ params, searchParams }: SitePageProps) {
  const { siteId } = await params;
  const sp = (await searchParams) || {};
  const from = Array.isArray(sp.from) ? sp.from[0] : sp.from;
  const to = Array.isArray(sp.to) ? sp.to[0] : sp.to;
  const supabase = await createClient();
  const [userResult, userIsAdmin] = await Promise.all([
    supabase.auth.getUser(),
    isAdmin(),
  ]);
  const user = userResult.data?.user ?? null;
  if (!user) {
    redirect('/login');
  }
  if (!userIsAdmin) {
    redirect(panelSitePath(siteId));
  }

  const { data: siteTimezoneRow } = await supabase
    .from('sites')
    .select('timezone, locale')
    .eq('id', siteId)
    .maybeSingle();

  // Phase B1: If URL doesn't contain from/to, redirect to TODAY (TRT) range in UTC.
  // This happens at the server boundary to avoid hydration mismatch.
  if (!from || !to) {
    const siteTimezone = (siteTimezoneRow as { timezone?: string | null; locale?: string | null } | null)?.timezone ?? null;
    const siteLocale = (siteTimezoneRow as { timezone?: string | null; locale?: string | null } | null)?.locale ?? null;
    const resolvedTimezone = resolveDashboardUiTimezone(siteTimezone, siteLocale);
    if (!siteTimezone && resolvedTimezone === 'UTC') {
      incrementRefactorMetric('timezone_fallback_used_total');
    }
    const { fromIso, toIso } = getTodayTrtUtcRange(new Date(), resolvedTimezone);
    const qp = new URLSearchParams();
    // Preserve any other params if present
    for (const [k, v] of Object.entries(sp)) {
      if (v == null) continue;
      if (k === 'from' || k === 'to') continue;
      if (Array.isArray(v)) {
        for (const vv of v) qp.append(k, vv);
      } else {
        qp.set(k, v);
      }
    }
    qp.set('from', from ?? fromIso);
    qp.set('to', to ?? toIso);
    redirect(`/dashboard/site/${siteId}?${qp.toString()}`);
  }

  const { data: site, error: siteError } = await supabase
    .from('sites')
    .select('id, name, domain, public_id, user_id, currency, timezone, locale, active_modules')
    .eq('id', siteId)
    .single();
  if (siteError || !site) {
    notFound();
  }

  const siteRole: SiteRole = 'admin';

  // Locale resolution: cookie (user preference) > site > user metadata > header
  const [headersList, cookieStore] = await Promise.all([headers(), cookies()]);
  const acceptLanguage = headersList.get('accept-language') ?? null;
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value ?? null;
  const resolvedLocale = resolveLocale(site, user?.user_metadata, acceptLanguage, cookieLocale);
  const effectiveUiTimezone = resolveDashboardUiTimezone(site.timezone ?? null, resolvedLocale);
  const providerTimezone =
    site.timezone && site.timezone.trim() && !(site.timezone.trim().toUpperCase() === 'UTC' && resolvedLocale.toLowerCase().startsWith('tr'))
      ? site.timezone
      : effectiveUiTimezone;

  return (
    <I18nProvider
      locale={resolvedLocale}
      siteConfig={{
        currency: site.currency ?? undefined,
        timezone: site.timezone && site.timezone.trim() ? providerTimezone : effectiveUiTimezone,
      }}
    >
      <SiteLocaleProvider
        value={{
          timezone: site.timezone && site.timezone.trim() ? providerTimezone : effectiveUiTimezone,
          currency: site.currency ?? undefined,
          locale: site.locale ?? undefined,
        }}
      >
        <DashboardShell
          siteId={siteId}
          siteName={site.name || undefined}
          siteDomain={site.domain || undefined}
          initialTodayRange={from && to ? { fromIso: from, toIso: to } : undefined}
          siteRole={siteRole}
          activeModules={(site.active_modules ?? []).filter((m: string): m is import('@/lib/types/modules').OpsMantikModule => typeof m === 'string' && isOpsMantikModule(m))}
        />
      </SiteLocaleProvider>
    </I18nProvider>
  );
}
