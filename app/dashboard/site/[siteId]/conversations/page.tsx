import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { panelSitePath } from '@/lib/auth/site-operational-route';
import { validateSiteAccess } from '@/lib/security/validate-site-access';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ siteId: string }>;
}

/** CRM conversations surface retired (CUT-01C); send operators to panel. */
export default async function ConversationDeskRedirect({ params }: PageProps) {
  const { siteId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed) notFound();

  redirect(panelSitePath(siteId));
}
