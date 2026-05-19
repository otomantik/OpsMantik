import { cookies, headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { SiteLocaleProvider } from '@/components/context/site-locale-context';
import { resolveLocale } from '@/lib/i18n/locale';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { hasCapability } from '@/lib/auth/rbac';
import { OciControlPanel } from '@/components/dashboard/oci-control/oci-control-panel';
import { PanelChrome } from '@/components/panel/panel-chrome';
import { panelSitePath } from '@/lib/auth/site-operational-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PanelOciPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const sp = (await searchParams) || {};
  const siteIdRaw = Array.isArray(sp.siteId) ? sp.siteId[0] : sp.siteId;
  const siteId = typeof siteIdRaw === 'string' && siteIdRaw.trim() ? siteIdRaw.trim() : null;
  if (!siteId) redirect('/panel');

  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed) notFound();

  const canOperate = Boolean(access.role && hasCapability(access.role, 'queue:operate'));
  if (!canOperate) {
    redirect(panelSitePath(siteId));
  }

  const { data: site } = await adminClient
    .from('sites')
    .select('name, locale, currency, timezone')
    .eq('id', siteId)
    .single();
  if (!site) notFound();

  const [headersList, cookieStore] = await Promise.all([headers(), cookies()]);
  const acceptLanguage = headersList.get('accept-language') ?? null;
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value ?? null;
  const resolvedLocale = resolveLocale(site, user?.user_metadata, acceptLanguage, cookieLocale);

  return (
    <I18nProvider
      locale={resolvedLocale}
      siteConfig={{ currency: site.currency ?? undefined, timezone: site.timezone ?? undefined }}
    >
      <SiteLocaleProvider
        value={{
          timezone: site.timezone ?? 'UTC',
          currency: site.currency ?? 'USD',
          locale: resolvedLocale,
        }}
      >
        <PanelChrome
          siteId={siteId}
          siteName={site.name || 'OpsMantik'}
          locale={resolvedLocale}
          active="oci"
        >
          <OciControlPanel siteId={siteId} siteName={site.name || undefined} canOperate={canOperate} />
        </PanelChrome>
      </SiteLocaleProvider>
    </I18nProvider>
  );
}
