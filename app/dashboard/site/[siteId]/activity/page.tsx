import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { isAdmin } from '@/lib/auth/isAdmin';
import { ActivityLogShell } from '@/components/dashboard/ActivityLogShell';

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
    .select('id, name, domain')
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

  return (
    <ActivityLogShell
      siteId={siteId}
      siteName={site.name || site.domain || undefined}
    />
  );
}

