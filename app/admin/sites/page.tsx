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

interface RpcSiteResult {
  site_id: string;
  name: string | null;
  domain: string | null;
  public_id: string;
  owner_user_id: string;
  owner_email: string | null;
  last_event_at: string | null;
  last_category: string | null;
  last_label: string | null;
  minutes_ago: number | null;
  status: 'RECEIVING' | 'NO_TRAFFIC';
}

interface GetSitesResult {
  sites: SiteWithStatus[];
  error: string | null;
}

async function getSitesWithStatus(search?: string): Promise<GetSitesResult> {
  const supabase = await createClient();
  
  // Call RPC function - single query eliminates N+1
  const { data: rpcResults, error: rpcError } = await supabase
    .rpc('admin_sites_list', {
      search: search || null,
      limit_count: 1000, // High limit for admin view
      offset_count: 0
    });

  if (rpcError) {
    return {
      sites: [],
      error: rpcError.message || 'Failed to load sites. Check profiles role + RPC.'
    };
  }

  if (!rpcResults) {
    return {
      sites: [],
      error: null
    };
  }

  // Transform RPC results to match component interface
  const sites: SiteWithStatus[] = (rpcResults as RpcSiteResult[]).map((rpc) => ({
    id: rpc.site_id,
    name: rpc.name,
    domain: rpc.domain,
    public_id: rpc.public_id,
    user_id: rpc.owner_user_id,
    owner_email: rpc.owner_email,
    last_event_at: rpc.last_event_at,
    status: rpc.status === 'RECEIVING' ? 'Receiving events' : 'No traffic'
  }));

  return {
    sites,
    error: null
  };
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

  const { sites, error } = await getSitesWithStatus();

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

        {/* Error Display */}
        {error && (
          <Card className="glass border-red-800/50 mb-6">
            <CardContent className="pt-6">
              <div className="bg-red-900/20 border border-red-700/50 rounded p-4">
                <p className="font-mono text-sm text-red-400 font-semibold mb-1">
                  Error loading sites
                </p>
                <p className="font-mono text-xs text-red-300">
                  {error}
                </p>
                <p className="font-mono text-xs text-red-400/70 mt-2">
                  Check profiles role + RPC function permissions
                </p>
              </div>
            </CardContent>
          </Card>
        )}

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
