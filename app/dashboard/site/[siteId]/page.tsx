import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { DashboardLayout } from '@/components/dashboard/dashboard-layout';
import { isAdmin } from '@/lib/auth/isAdmin';

interface SitePageProps {
  params: Promise<{ siteId: string }>;
}

export default async function SiteDashboardPage({ params }: SitePageProps) {
  const { siteId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const userIsAdmin = await isAdmin();

  const { data: site, error: siteError } = await supabase
    .from('sites')
    .select('id, name, domain, public_id')
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

  // Calculate default health (can be enhanced with actual health check)
  const defaultHealth = {
    data_latency: new Date().toISOString(),
    completeness: 1.0,
    last_sync: new Date().toISOString(),
    status: 'healthy' as const,
  };

  return (
    <DashboardLayout
      siteId={siteId}
      siteName={site.name || undefined}
      siteDomain={site.domain || undefined}
      initialHealth={defaultHealth}
    />
  );
}

// Sign out action (server action)
async function signOut() {
  'use server';
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
