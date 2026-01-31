import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { isAdmin } from '@/lib/auth/isAdmin';
import { getTodayTrtUtcRange } from '@/lib/time/today-range';

// Canlıda eski HTML/JS cache'lenmesin; her istek güncel build ile dönsün.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SitePageProps {
  params: Promise<{ siteId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SiteDashboardPage({ params, searchParams }: SitePageProps) {
  const { siteId } = await params;
  const sp = (await searchParams) || {};
  const from = Array.isArray(sp.from) ? sp.from[0] : sp.from;
  const to = Array.isArray(sp.to) ? sp.to[0] : sp.to;

  // Phase B1: If URL doesn't contain from/to, redirect to TODAY (TRT) range in UTC.
  // This happens at the server boundary to avoid hydration mismatch.
  if (!from || !to) {
    const { fromIso, toIso } = getTodayTrtUtcRange();
    const qp = new URLSearchParams();
    // Preserve any other params if present
    for (const [k, v] of Object.entries(sp)) {
      if (v == null) continue;
      if (k === 'from' || k === 'to') continue;
      if (Array.isArray(v)) {
        for (const vv of v) qp.append(k, vv);
      } else {
        qp.set(k, v);
      }
    }
    qp.set('from', from ?? fromIso);
    qp.set('to', to ?? toIso);
    redirect(`/dashboard/site/${siteId}?${qp.toString()}`);
  }

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

  // Yayındaki ekran: DashboardShell (today range URL ile; hydration uyumu için)
  return (
    <DashboardShell
      siteId={siteId}
      siteName={site.name || undefined}
      siteDomain={site.domain || undefined}
      initialTodayRange={from && to ? { fromIso: from, toIso: to } : undefined}
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
