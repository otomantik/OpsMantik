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

  // Check if user is admin
  const userIsAdmin = await isAdmin();

  // Verify site access: user must own site, be a member, or be admin
  const { data: site, error: siteError } = await supabase
    .from('sites')
    .select('id, name, domain, public_id')
    .eq('id', siteId)
    .single();

  if (siteError || !site) {
    // Site doesn't exist or RLS blocked access
    notFound();
  }

  // If not admin, verify user has access (owner or member)
  if (!userIsAdmin) {
    // Check if user owns the site
    const { data: ownedSite } = await supabase
      .from('sites')
      .select('id')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .single();

    if (!ownedSite) {
      // Check if user is a member
      const { data: membership } = await supabase
        .from('site_members')
        .select('site_id')
        .eq('site_id', siteId)
        .eq('user_id', user.id)
        .single();

      if (!membership) {
        // User has no access to this site
        notFound();
      }
    }
  }

  return (
    <div className="min-h-screen bg-[#020617] p-6 relative">
      {/* Month Boundary Banner */}
      <MonthBoundaryBanner />
      
      {/* Fixed Call Monitor - Top Right (Desktop) */}
      <div className="hidden lg:block fixed top-6 right-6 z-50 w-72">
        <CallAlertWrapper siteId={siteId} />
      </div>

      {/* Mobile Call Monitor - Bottom Sheet */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 max-h-[50vh] overflow-y-auto bg-slate-900/95 backdrop-blur-sm border-t border-slate-800/50 pb-safe">
        <CallAlertWrapper siteId={siteId} />
      </div>

      <div className="max-w-[1920px] mx-auto pr-0 lg:pr-80">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <div className="flex items-center gap-3">
              <Link href="/dashboard">
                <Button 
                  variant="ghost" 
                  size="sm"
                  className="text-slate-400 hover:text-slate-200 font-mono text-xs"
                >
                  ← Back to Dashboard
                </Button>
              </Link>
              <h1 className="text-3xl font-bold text-slate-100 font-mono tracking-tight">
                {site.name || site.domain || 'Site Dashboard'}
              </h1>
            </div>
            <p className="text-sm text-slate-400 font-mono mt-1">
              {site.domain || site.public_id} • Real-time Intelligence
            </p>
          </div>
          <div className="flex gap-2">
            {process.env.NODE_ENV === 'development' && (
              <Link href="/test-page">
                <Button 
                  variant="outline" 
                  className="bg-slate-800/60 border-slate-700/50 text-slate-200 hover:bg-slate-700/60 font-mono text-xs backdrop-blur-sm"
                >
                  🧪 TEST PAGE
                </Button>
              </Link>
            )}
            <form action={signOut}>
              <Button 
                type="submit" 
                variant="outline"
                className="bg-slate-800/60 border-slate-700/50 text-slate-200 hover:bg-slate-700/60 font-mono text-xs backdrop-blur-sm"
              >
                🚪 SIGN OUT
              </Button>
            </form>
          </div>
        </div>
        
        {/* Main Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Top Row: Stats Cards */}
          <div className="col-span-12">
            <StatsCards siteId={siteId} />
          </div>
          
          {/* Left Column: Live Feed */}
          <div className="col-span-12 lg:col-span-8">
            <LiveFeed siteId={siteId} />
          </div>
          
          {/* Right Column: Tracked Events */}
          <div className="col-span-12 lg:col-span-4">
            <TrackedEventsPanel siteId={siteId} />
          </div>
          
          {/* Bottom: Conversions (Full Width) */}
          <div className="col-span-12">
            <ConversionTracker siteId={siteId} />
          </div>
        </div>
      </div>
    </div>
  );
}
