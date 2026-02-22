import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/auth/is-admin';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SitesTableWithSearch } from './sites-table';
import { headers } from 'next/headers';
import { resolveLocale } from '@/lib/i18n/locale';
import { translate } from '@/lib/i18n/t';

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

  // Locale resolution for Admin
  const headersList = await headers();
  const acceptLanguage = headersList.get('accept-language') ?? null;
  const resolvedLocale = resolveLocale(undefined, user?.user_metadata, acceptLanguage);

  const { sites, error } = await getSitesWithStatus();

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-[1920px] mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {translate(resolvedLocale, 'admin.sites.title')}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {translate(resolvedLocale, 'admin.sites.subtitle', {
                count: sites.length,
                plural: sites.length !== 1 ? 's' : ''
              })}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/dashboard">
              <Button
                variant="outline"
                className="text-sm"
              >
                ← {translate(resolvedLocale, 'common.dashboard')}
              </Button>
            </Link>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="bg-destructive/10 border border-destructive/20 rounded p-4">
                <p className="text-sm text-destructive font-semibold mb-1">
                  {translate(resolvedLocale, 'admin.sites.errorLoading')}
                </p>
                <p className="text-sm text-destructive">
                  {error}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  {translate(resolvedLocale, 'admin.sites.rpcHelp')}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sites List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              {translate(resolvedLocale, 'admin.sites.title')}
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              {translate(resolvedLocale, 'admin.sites.openDashboardDesc')}
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
