import { cookies, headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { SiteLocaleProvider } from '@/components/context/site-locale-context';
import { resolveLocale } from '@/lib/i18n/locale';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { PanelChrome } from '@/components/panel/panel-chrome';
import { InstallCenter } from '@/components/ops-center/install/install-center';
import { loadInstallSiteSnapshot } from '@/lib/panel/load-install-snapshot';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ siteId: string }>;
}

export default async function PanelInstallPage({ params }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { siteId } = await params;
  if (!siteId?.trim()) redirect('/panel');

  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed) notFound();

  const snapshot = await loadInstallSiteSnapshot(siteId);
  if (!snapshot) notFound();

  const [headersList, cookieStore] = await Promise.all([headers(), cookies()]);
  const acceptLanguage = headersList.get('accept-language') ?? null;
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value ?? null;
  const resolvedLocale = resolveLocale(
    { locale: snapshot.siteLocale },
    user?.user_metadata,
    acceptLanguage,
    cookieLocale
  );

  return (
    <I18nProvider locale={resolvedLocale}>
      <SiteLocaleProvider
        value={{
          timezone: snapshot.siteTimezone ?? 'UTC',
          currency: snapshot.siteCurrency ?? 'USD',
          locale: resolvedLocale,
        }}
      >
        <PanelChrome
          siteId={siteId}
          siteName={snapshot.siteName}
          locale={resolvedLocale}
          active="install"
        >
          <InstallCenter siteId={siteId} snapshot={snapshot} locale={resolvedLocale} />
        </PanelChrome>
      </SiteLocaleProvider>
    </I18nProvider>
  );
}
