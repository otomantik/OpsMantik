import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { StatsCards } from '@/components/dashboard/stats-cards';
import { LiveFeed } from '@/components/dashboard/live-feed';
import { CallAlertWrapper } from '@/components/dashboard/call-alert-wrapper';
import { TrackedEventsPanel } from '@/components/dashboard/tracked-events-panel';
import { ConversionTracker } from '@/components/dashboard/conversion-tracker';
import { MonthBoundaryBanner } from '@/components/dashboard/month-boundary-banner';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { isAdmin } from '@/lib/auth/isAdmin';
import { ChevronLeft } from 'lucide-react';

async function signOut() {
  'use server';
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

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

  return (
    <div className="min-h-screen bg-[#020617] relative">
      <MonthBoundaryBanner />

      {/* Top Navigation Bar (Ads-like navigation) */}
      <div className="border-b border-slate-800/60 bg-slate-900/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1920px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-slate-500 hover:text-slate-300 transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div className="h-6 w-[1px] bg-slate-800 mx-1"></div>
            <div>
              <h1 className="text-sm font-mono font-bold text-slate-100 uppercase tracking-tighter">
                {site.name || site.domain}
              </h1>
              <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest leading-none">
                Site Insights &bull; {site.public_id.slice(0, 8)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {process.env.NODE_ENV === 'development' && (
              <Link href="/test-page">
                <Button variant="ghost" size="sm" className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 uppercase tracking-wider h-8">
                  🧪 Simulator
                </Button>
              </Link>
            )}
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm" className="text-[10px] font-mono text-slate-400 hover:text-slate-200 uppercase tracking-wider h-8 border border-slate-800/50">
                Sign Out
              </Button>
            </form>
          </div>
        </div>
      </div>

      <div className="max-w-[1920px] mx-auto p-6 space-y-6">
        {/* KPI Row - Top Scan */}
        <section>
          <StatsCards siteId={siteId} />
        </section>

        {/* Dynamic Activity Layout (Google Analytics / Ads mix) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

          {/* Main Stream (Middle Focus) */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            {/* Call Monitor - High Intent Stream */}
            <div id="call-monitor">
              <CallAlertWrapper siteId={siteId} />
            </div>

            {/* Live Activity Feed - Engagement Volume */}
            <div id="live-feed">
              <LiveFeed siteId={siteId} />
            </div>
          </div>

          {/* Side Panels (Context & Configuration) */}
          <div className="lg:col-span-4 flex flex-col gap-6 sticky top-20">
            <TrackedEventsPanel siteId={siteId} />
            <ConversionTracker siteId={siteId} />

            {/* Info Chip */}
            <div className="p-4 rounded-lg bg-slate-900/20 border border-slate-800/50">
              <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1 italic">Optimization Tip</p>
              <p className="text-[11px] font-mono text-slate-400">
                Real-time fingerprint matching is active. Calls are matched to web sessions via browser tokens.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Sticky Monitor Hook (Optional if needed by previous design, keeping UI clean) */}
      <div className="lg:hidden h-20"></div>
    </div>
  );
}
