import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { isAdmin } from '@/lib/auth/is-admin';
import { getTodayTrtUtcRange } from '@/lib/time/today-range';
import { resolveLocale } from '@/lib/i18n/locale';
import { translate } from '@/lib/i18n/t';
import type { Metadata } from 'next';
import type { SiteRole } from '@/lib/auth/rbac';

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

  const headersList = await headers();
  const acceptLanguage = headersList.get('accept-language') ?? null;
  const resolvedLocale = resolveLocale(site, user?.user_metadata, acceptLanguage);

  const siteName = site?.name || site?.domain || 'OpsMantik';
  const metaTitle = translate('meta.title', resolvedLocale);
  const metaDesc = translate('meta.description', resolvedLocale);

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

  // Phase B1: If URL doesn't contain from/to, redirect to TODAY (TRT) range in UTC.
  // This happens at the server boundary to avoid hydration mismatch.
  if (!from || !to) {
    const { fromIso, toIso } = getTodayTrtUtcRange();
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

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const userIsAdmin = await isAdmin();

  const { data: site, error: siteError } = await supabase
    .from('sites')
    .select('id, name, domain, public_id, user_id, currency, timezone, locale')
    .eq('id', siteId)
    .single();

  if (siteError || !site) {
    notFound();
  }

  if (!userIsAdmin) {
    const { data: ownedSite } = await supabase
      .from('sites')
      .select('id')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .single();

    if (!ownedSite) {
      const { data: membership } = await supabase
        .from('site_members')
        .select('site_id')
        .eq('site_id', siteId)
        .eq('user_id', user.id)
        .single();

      if (!membership) {
        notFound();
      }
    }
  }

  // Site role (for client-side capability mapping)
  let siteRole: SiteRole = 'analyst';
  if (userIsAdmin) {
    siteRole = 'admin';
  } else {
    // Owner → highest privilege
    const isOwner = site.user_id === user.id;
    if (isOwner) {
      siteRole = 'owner';
    } else {
      const { data: membership } = await supabase
        .from('site_members')
        .select('role')
        .eq('site_id', siteId)
        .eq('user_id', user.id)
        .maybeSingle();
      const r = (membership?.role || '').toString();
      if (r === 'admin' || r === 'operator' || r === 'analyst' || r === 'billing') {
        siteRole = r as SiteRole;
      }
    }
  }

  // Locale resolution: site.locale -> user.user_metadata.locale -> Accept-Language -> en-US
  const headersList = await headers();
  const acceptLanguage = headersList.get('accept-language') ?? null;
  const resolvedLocale = resolveLocale(site, user?.user_metadata, acceptLanguage);

  return (
    <I18nProvider
      locale={resolvedLocale}
      siteConfig={{
        currency: site.currency ?? undefined,
        timezone: site.timezone ?? undefined,
      }}
    >
      <DashboardShell
        siteId={siteId}
        siteName={site.name || undefined}
        siteDomain={site.domain || undefined}
        initialTodayRange={from && to ? { fromIso: from, toIso: to } : undefined}
        siteRole={siteRole}
      />
    </I18nProvider>
  );
}
