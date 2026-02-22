import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { SiteSetup } from '@/components/dashboard/site-setup';
import { SitesManager } from '@/components/dashboard/sites-manager';
import { SiteSwitcher } from '@/components/dashboard/site-switcher';
import { MonthBoundaryBanner } from '@/components/dashboard/month-boundary-banner';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { isAdmin } from '@/lib/auth/is-admin';

import { headers } from 'next/headers';
import { resolveLocale } from '@/lib/i18n/locale';
import { translate } from '@/lib/i18n/t';

async function signOut() {
  'use server';
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check if user is admin
  const userIsAdmin = await isAdmin();

  // Fetch accessible sites: owner OR member OR admin (RLS enforces)
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, domain, public_id, locale')
    .order('created_at', { ascending: false });

  const siteCount = sites?.length || 0;

  // Locale resolution: use first site's locale or user metadata or header
  const headersList = await headers();
  const acceptLanguage = headersList.get('accept-language') ?? null;
  const firstSite = sites && sites.length > 0 ? sites[0] : null;
  const resolvedLocale = resolveLocale(firstSite, user?.user_metadata, acceptLanguage);

  // Router logic:
  // 0 sites => show CTA + create site UI
  // 1 site => redirect to /dashboard/site/<id>
  // many => show Site Switcher + recent sites list

  if (siteCount === 1 && sites && sites[0]) {
    redirect(`/dashboard/site/${sites[0].id}`);
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6 relative">
      {/* Month Boundary Banner */}
      <MonthBoundaryBanner />

      <div className="max-w-[1920px] mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {translate('dashboard.warRoom', resolvedLocale)}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {translate('dashboard.commandCenterSub', resolvedLocale)}
            </p>
          </div>
          <div className="flex gap-2">
            {process.env.NODE_ENV === 'development' && (
              <Link href="/test-page">
                <Button variant="outline">
                  🧪 {translate('dashboard.testPage', resolvedLocale)}
                </Button>
              </Link>
            )}
            <form action={signOut}>
              <Button type="submit" variant="outline">
                🚪 {translate('dashboard.signOut', resolvedLocale)}
              </Button>
            </form>
          </div>
        </div>

        {/* Router Content */}
        {siteCount === 0 ? (
          // 0 sites: Show CTA + create site UI
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12">
              <SitesManager />
            </div>
            {process.env.NODE_ENV === 'development' && (
              <div className="col-span-12">
                <SiteSetup />
              </div>
            )}
          </div>
        ) : (
          // Many sites: Show Site Switcher + recent sites list
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 lg:col-span-4">
              <SiteSwitcher isAdmin={userIsAdmin} />
            </div>
            <div className="col-span-12 lg:col-span-8">
              <SitesManager />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
