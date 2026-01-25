import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/auth/isAdmin';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SitesTableWithSearch } from './sites-table';

interface SiteWithStatus {
  id: string;
  name: string | null;
  domain: string | null;
  public_id: string;
  user_id: string;
  owner_email: string | null;
  last_event_at: string | null;
  status: 'Receiving events' | 'No traffic';
}

async function getSitesWithStatus(): Promise<SiteWithStatus[]> {
  const supabase = await createClient();
  
  // Get all sites (RLS allows admin to see all)
  const { data: sites, error: sitesError } = await supabase
    .from('sites')
    .select('id, name, domain, public_id, user_id')
    .order('created_at', { ascending: false });

  if (sitesError || !sites) {
    return [];
  }

  // Get current month for partition queries
  const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
  const currentMonthDate = new Date(currentMonth);
  const prevMonth = new Date(currentMonthDate);
  prevMonth.setMonth(prevMonth.getMonth() - 1);
  const prevMonthStr = prevMonth.toISOString().slice(0, 7) + '-01';

  // For each site, get last event (simplified - can be optimized with batch queries later)
  const sitesWithStatus: SiteWithStatus[] = await Promise.all(
    sites.map(async (site) => {
      // Try current month first
      const { data: sessions } = await supabase
        .from('sessions')
        .select('id')
        .eq('site_id', site.id)
        .eq('created_month', currentMonth)
        .limit(1);

      let lastEventAt: string | null = null;
      let status: 'Receiving events' | 'No traffic' = 'No traffic';

      if (sessions && sessions.length > 0) {
        const { data: event } = await supabase
          .from('events')
          .select('created_at')
          .eq('session_id', sessions[0].id)
          .eq('session_month', currentMonth)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (event) {
          lastEventAt = event.created_at;
          status = 'Receiving events';
        }
      }

      // If no event in current month, try previous month
      if (!lastEventAt) {
        const { data: prevSessions } = await supabase
          .from('sessions')
          .select('id')
          .eq('site_id', site.id)
          .eq('created_month', prevMonthStr)
          .limit(1);

        if (prevSessions && prevSessions.length > 0) {
          const { data: prevEvent } = await supabase
            .from('events')
            .select('created_at')
            .eq('session_id', prevSessions[0].id)
            .eq('session_month', prevMonthStr)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (prevEvent) {
            lastEventAt = prevEvent.created_at;
            status = 'Receiving events';
          }
        }
      }

      return {
        id: site.id,
        name: site.name,
        domain: site.domain,
        public_id: site.public_id,
        user_id: site.user_id,
        owner_email: null, // Can be enhanced later with proper email lookup
        last_event_at: lastEventAt,
        status,
      };
    })
  );

  return sitesWithStatus;
}

export default async function AdminSitesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Guard: redirect to dashboard if not admin
  const userIsAdmin = await isAdmin();
  if (!userIsAdmin) {
    redirect('/dashboard');
  }

  const sites = await getSitesWithStatus();

  return (
    <div className="min-h-screen bg-[#020617] p-6">
      <div className="max-w-[1920px] mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-100 font-mono tracking-tight">
              ADMIN • All Sites
            </h1>
            <p className="text-sm text-slate-400 font-mono mt-1">
              Global site management • {sites.length} site{sites.length !== 1 ? 's' : ''} total
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/dashboard">
              <Button 
                variant="outline" 
                className="bg-slate-800/60 border-slate-700/50 text-slate-200 hover:bg-slate-700/60 font-mono text-xs backdrop-blur-sm"
              >
                ← Dashboard
              </Button>
            </Link>
          </div>
        </div>

        {/* Sites List */}
        <Card className="glass border-slate-800/50">
          <CardHeader>
            <CardTitle className="text-lg font-mono text-slate-200">All Sites</CardTitle>
            <CardDescription className="font-mono text-xs text-slate-400">
              Click "Open Dashboard" to view site details
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SitesTableWithSearch sites={sites} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
