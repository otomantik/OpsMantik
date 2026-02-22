import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { resolveLocale } from '@/lib/i18n/locale';
import { isAdmin } from '@/lib/auth/is-admin';
import { ActivityLogShell } from '@/components/dashboard/activity-log-shell';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ siteId: string }>;
}

export default async function ActivityLogPage({ params }: PageProps) {
  const { siteId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const userIsAdmin = await isAdmin();

  const { data: site, error: siteError } = await supabase
    .from('sites')
    .select('id, name, domain, currency, timezone, locale')
    .eq('id', siteId)
    .single();

  if (siteError || !site) notFound();

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

      if (!membership) notFound();
    }
  }

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
      <ActivityLogShell
        siteId={siteId}
        siteName={site.name || site.domain || undefined}
      />
    </I18nProvider>
  );
}

