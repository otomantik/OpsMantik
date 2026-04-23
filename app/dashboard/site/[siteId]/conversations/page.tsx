import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { isAdmin } from '@/lib/auth/is-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ siteId: string }>;
}

/**
 * CRM / follow-up desk removed from product surface; old links go to Intent command center.
 */
export default async function ConversationDeskRedirect({ params }: PageProps) {
  const { siteId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: site, error } = await supabase.from('sites').select('id, user_id').eq('id', siteId).single();
  if (error || !site) notFound();

  const userIsAdmin = await isAdmin();
  if (!userIsAdmin && site.user_id !== user.id) {
    const { data: membership } = await supabase
      .from('site_memberships')
      .select('site_id')
      .eq('site_id', siteId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!membership) notFound();
  }

  redirect(`/dashboard/site/${siteId}`);
}
