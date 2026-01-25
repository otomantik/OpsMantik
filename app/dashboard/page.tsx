import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { StatsCards } from '@/components/dashboard/stats-cards';
import { LiveFeed } from '@/components/dashboard/live-feed';
import { CallAlertWrapper } from '@/components/dashboard/call-alert-wrapper';
import { TrackedEventsPanel } from '@/components/dashboard/tracked-events-panel';
import { ConversionTracker } from '@/components/dashboard/conversion-tracker';
import { SiteSetup } from '@/components/dashboard/site-setup';
import { SitesManager } from '@/components/dashboard/sites-manager';
import { SiteSwitcher } from '@/components/dashboard/site-switcher';
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

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check if user is admin
  const userIsAdmin = await isAdmin();

  // Fetch sites: admin sees all, normal users see only their sites (RLS enforces)
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, domain, public_id')
    .order('created_at', { ascending: false });

  const hasSites = sites && sites.length > 0;
  const siteCount = sites?.length || 0;

  // Auto-redirect if user has exactly 1 site
  if (siteCount === 1 && sites && sites[0]) {
    redirect(`/dashboard/site/${sites[0].id}`);
  }

  return (
    <div className="min-h-screen bg-[#020617] p-6 relative">
      {/* Month Boundary Banner */}
      <MonthBoundaryBanner />
      
      {/* Fixed Call Monitor - Top Right (only if user has sites) */}
      {hasSites && (
        <div className="fixed top-6 right-6 z-50 w-72">
          <CallAlertWrapper />
        </div>
      )}

      <div className={`max-w-[1920px] mx-auto ${hasSites ? 'pr-80' : ''}`}>
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-100 font-mono tracking-tight">
              WAR ROOM
            </h1>
            <p className="text-sm text-slate-400 font-mono mt-1">
              Command Center • Real-time Intelligence • Phone Matching
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/test-page">
              <Button 
                variant="outline" 
                className="bg-slate-800/60 border-slate-700/50 text-slate-200 hover:bg-slate-700/60 font-mono text-xs backdrop-blur-sm"
              >
                🧪 TEST PAGE
              </Button>
            </Link>
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
                    <div className="grid grid-cols-12 gap-4">
                      {/* Site Switcher - Show if multiple sites */}
                      {siteCount > 1 && (
                        <div className="col-span-12 lg:col-span-4">
                          <SiteSwitcher isAdmin={userIsAdmin} />
                        </div>
                      )}

                      {/* Sites Manager - Always show (for creating sites) */}
                      <div className={`col-span-12 ${siteCount > 1 ? 'lg:col-span-8' : ''}`}>
                        <SitesManager />
                      </div>

                      {/* Site Setup - Show if no sites (legacy) */}
                      {!hasSites && (
                        <div className="col-span-12">
                          <SiteSetup />
                        </div>
                      )}

                      {/* Top Row: Stats Cards */}
                      {hasSites && (
                        <div className="col-span-12">
                          <StatsCards />
                        </div>
                      )}
                      
                      {/* Left Column: Live Feed */}
                      {hasSites && (
                        <div className="col-span-12 lg:col-span-8">
                          <LiveFeed />
                        </div>
                      )}
                      
                      {/* Right Column: Tracked Events */}
                      {hasSites && (
                        <div className="col-span-12 lg:col-span-4">
                          <TrackedEventsPanel />
                        </div>
                      )}
                      
                      {/* Bottom: Conversions (Full Width) */}
                      {hasSites && (
                        <div className="col-span-12">
                          <ConversionTracker />
                        </div>
                      )}
        </div>
      </div>
    </div>
  );
}
