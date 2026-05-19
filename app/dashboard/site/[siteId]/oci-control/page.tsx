import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { panelOciPath, panelSitePath } from '@/lib/auth/site-operational-route';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { hasCapability } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ siteId: string }>;
}

/** Legacy Komuta Merkezi OCI URL — canonical surface is `/panel/oci` (SEAL-03). */
export default async function OciControlRedirect({ params }: PageProps) {
  const { siteId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed) notFound();

  const canOperate = Boolean(access.role && hasCapability(access.role, 'queue:operate'));
  redirect(canOperate ? panelOciPath(siteId) : panelSitePath(siteId));
}
