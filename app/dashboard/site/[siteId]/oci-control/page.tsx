import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { headers, cookies } from 'next/headers';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { resolveLocale } from '@/lib/i18n/locale';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { OciControlPanel } from '@/components/dashboard/oci-control/oci-control-panel';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ siteId: string }>;
}

export default async function OciControlPage({ params }: PageProps) {
  const { siteId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: site } = await supabase
    .from('sites')
    .select('id, name, domain, currency, timezone, locale')
    .eq('id', siteId)
    .single();

  if (!site) notFound();

  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed) notFound();

  const [headersList, cookieStore] = await Promise.all([headers(), cookies()]);
  const acceptLanguage = headersList.get('accept-language') ?? null;
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value ?? null;
  const resolvedLocale = resolveLocale(site, user?.user_metadata, acceptLanguage, cookieLocale);

  return (
    <I18nProvider
      locale={resolvedLocale}
      siteConfig={{
        currency: site.currency ?? undefined,
        timezone: site.timezone ?? undefined,
      }}
    >
      <OciControlPanel
        siteId={siteId}
        siteName={site.name || site.domain || undefined}
      />
    </I18nProvider>
  );
}
