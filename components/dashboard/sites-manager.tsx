'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatTimestamp } from '@/lib/utils';

interface Site {
  id: string;
  name: string | null;
  domain: string;
  public_id: string;
}

export function SitesManager() {
  const [sites, setSites] = useState<Site[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSite, setNewSite] = useState<Site | null>(null);
  const [copied, setCopied] = useState(false);

  // Form state
  const [siteName, setSiteName] = useState('');
  const [domain, setDomain] = useState('');

  // Invite state (per site)
  const [inviteEmail, setInviteEmail] = useState<Record<string, string>>({});
  const [inviteLoading, setInviteLoading] = useState<Record<string, boolean>>({});
  const [inviteError, setInviteError] = useState<Record<string, string>>({});
  const [inviteSuccess, setInviteSuccess] = useState<Record<string, { loginUrl: string | null; message: string }>>({});

  // Install status state (per site)
  const [siteStatus, setSiteStatus] = useState<Record<string, {
    status: string;
    last_event_at: string | null;
    last_session_id: string | null;
    last_source: string | null;
    last_event_category: string | null;
    last_event_action: string | null;
  }>>({});
  const [statusLoading, setStatusLoading] = useState<Record<string, boolean>>({});

  // Fetch sites
  useEffect(() => {
    const fetchSites = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) return;

      const { data: sitesData, error: sitesError } = await supabase
        .from('sites')
        .select('id, name, domain, public_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (sitesError) {
        // Detailed error logging
        console.error('[SITES_MANAGER] Error fetching sites:', {
          message: sitesError?.message,
          code: sitesError?.code,
          details: sitesError?.details,
          hint: sitesError?.hint,
          raw: sitesError
        });
        
        // Check for PostgreSQL error code 42703 (undefined_column)
        // This indicates a schema mismatch - required columns are missing
        const isSchemaMismatch = sitesError.code === '42703' || 
                                 sitesError.code === 'PGRST116' ||
                                 (sitesError.message && (
                                   sitesError.message.includes('column') && 
                                   sitesError.message.includes('does not exist')
                                 ));
        
        if (isSchemaMismatch) {
          setError('Database schema mismatch: required columns missing on sites table (name/domain/public_id). Run migration.');
        } else {
          // Build human-readable error message
          let errorMessage = 'Failed to load sites';
          if (sitesError.message) {
            errorMessage = sitesError.message;
          }
          if (sitesError.code) {
            errorMessage += ` (Code: ${sitesError.code})`;
          }
          if (sitesError.details) {
            errorMessage += ` - ${sitesError.details}`;
          }
          setError(errorMessage);
        }
      } else {
        setSites(sitesData || []);
      }
      setIsLoading(false);
    };

    fetchSites();
  }, []);

  // Handle form submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setError(null);
    setNewSite(null);

    try {
      const response = await fetch('/api/sites/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: siteName,
          domain: domain,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create site');
      }

      // Add new site to list
      setSites([data.site, ...sites]);
      setNewSite(data.site);
      setSiteName('');
      setDomain('');
      setShowAddForm(false);
    } catch (err: any) {
      console.error('[SITES_MANAGER] Error:', err);
      setError(err.message || 'Unknown error');
    } finally {
      setIsCreating(false);
    }
  };

  // Get primary domain from env var or fallback
  const getPrimaryDomain = () => {
    // Use NEXT_PUBLIC_PRIMARY_DOMAIN if set (production-safe)
    const primaryDomain = process.env.NEXT_PUBLIC_PRIMARY_DOMAIN;
    if (primaryDomain) {
      return primaryDomain;
    }
    // Fallback to current hostname (development/local)
    return typeof window !== 'undefined' ? window.location.hostname : 'yourdomain.com';
  };

  // Handle customer invite
  const handleInvite = async (siteId: string) => {
    const email = inviteEmail[siteId]?.trim();
    if (!email) {
      setInviteError({ ...inviteError, [siteId]: 'Email is required' });
      return;
    }

    setInviteLoading({ ...inviteLoading, [siteId]: true });
    setInviteError({ ...inviteError, [siteId]: '' });
    setInviteSuccess({ ...inviteSuccess, [siteId]: { loginUrl: null, message: '' } });

    try {
      const response = await fetch('/api/customers/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email,
          site_id: siteId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to invite customer');
      }

      setInviteSuccess({
        ...inviteSuccess,
        [siteId]: {
          loginUrl: data.login_url || null,
          message: data.message || 'Customer invited successfully',
        },
      });
      setInviteEmail({ ...inviteEmail, [siteId]: '' });
      
      // Refresh sites list to reflect ownership change
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err: any) {
      console.error('[SITES_MANAGER] Invite error:', err);
      setInviteError({ ...inviteError, [siteId]: err.message || 'Unknown error' });
    } finally {
      setInviteLoading({ ...inviteLoading, [siteId]: false });
    }
  };

  // Handle install verification
  const handleVerifyInstall = async (siteId: string) => {
    setStatusLoading({ ...statusLoading, [siteId]: true });

    try {
      const response = await fetch(`/api/sites/${siteId}/status`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to verify install');
      }

      setSiteStatus({
        ...siteStatus,
        [siteId]: {
          status: data.status,
          last_event_at: data.last_event_at,
          last_session_id: data.last_session_id,
          last_source: data.last_source,
          last_event_category: data.last_event_category,
          last_event_action: data.last_event_action,
        },
      });
    } catch (err: any) {
      console.error('[SITES_MANAGER] Status check error:', err);
      setSiteStatus({
        ...siteStatus,
        [siteId]: {
          status: 'Error checking status',
          last_event_at: null,
          last_session_id: null,
          last_source: null,
          last_event_category: null,
          last_event_action: null,
        },
      });
    } finally {
      setStatusLoading({ ...statusLoading, [siteId]: false });
    }
  };

  // Check if using fallback domain
  const isUsingFallback = !process.env.NEXT_PUBLIC_PRIMARY_DOMAIN;

  // Copy snippet to clipboard
  const copySnippet = async () => {
    if (!newSite) return;

    const domain = getPrimaryDomain();
    // Always include data-api with console domain
    const apiUrl = `https://console.${domain}/api/sync`;
    const snippet = `<script defer src="https://assets.${domain}/assets/core.js" data-site-id="${newSite.public_id}" data-api="${apiUrl}"></script>`;
    
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[SITES_MANAGER] Copy failed:', err);
      // Fallback: select text
      const textarea = document.createElement('textarea');
      textarea.value = snippet;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <Card className="glass border-slate-800/50">
        <CardContent className="p-6">
          <p className="font-mono text-sm text-slate-400">Loading sites...</p>
        </CardContent>
      </Card>
    );
  }

  // Show schema mismatch error prominently if present
  if (error && error.includes('Database schema mismatch')) {
    return (
      <Card className="glass border-slate-800/50">
        <CardHeader>
          <CardTitle className="text-lg font-mono text-slate-200">Sites</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="bg-red-900/20 border border-red-700/50 p-4 rounded space-y-3">
            <p className="font-mono text-sm text-red-400 font-semibold">
              ⚠️ Database Schema Mismatch
            </p>
            <p className="font-mono text-xs text-red-300">
              {error}
            </p>
            <div className="mt-3 pt-3 border-t border-red-700/30">
              <p className="font-mono text-xs text-slate-400 mb-2">To fix this:</p>
              <ol className="font-mono text-xs text-slate-300 space-y-1 list-decimal list-inside">
                <li>Check your Supabase migrations are applied</li>
                <li>Verify the <code className="text-slate-200">sites</code> table has columns: <code className="text-slate-200">name</code>, <code className="text-slate-200">domain</code>, <code className="text-slate-200">public_id</code></li>
                <li>Run: <code className="text-slate-200">supabase db push</code> or apply migrations manually</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass border-slate-800/50">
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle className="text-lg font-mono text-slate-200">Sites</CardTitle>
            <CardDescription className="font-mono text-xs text-slate-400 mt-1">
              Manage your tracking sites
            </CardDescription>
          </div>
          <Button
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-emerald-600 hover:bg-emerald-700 font-mono text-xs"
            size="sm"
          >
            {showAddForm ? '✕ Cancel' : '+ Add Site'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Error Display - Visible error box for fetch errors */}
        {error && !error.includes('Database schema mismatch') && (
          <div className="bg-red-900/20 border border-red-700/50 p-4 rounded space-y-2">
            <p className="font-mono text-sm text-red-400 font-semibold">
              ⚠️ Error Loading Sites
            </p>
            <p className="font-mono text-xs text-red-300 break-words">
              {error}
            </p>
            <p className="font-mono text-xs text-red-400/70 mt-2">
              Check browser console for detailed error information.
            </p>
          </div>
        )}
        {/* Add Site Form */}
        {showAddForm && (
          <form onSubmit={handleSubmit} className="bg-slate-900/50 p-4 rounded border border-slate-700/50 space-y-3">
            <div>
              <label htmlFor="site-name" className="block font-mono text-xs text-slate-300 mb-1">
                Site Name *
              </label>
              <input
                id="site-name"
                type="text"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                required
                className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded text-slate-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                placeholder="My Website"
              />
            </div>
            <div>
              <label htmlFor="domain" className="block font-mono text-xs text-slate-300 mb-1">
                Domain *
              </label>
              <input
                id="domain"
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                required
                className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded text-slate-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                placeholder="example.com"
              />
              <p className="font-mono text-xs text-slate-500 mt-1">
                Protocol and path will be stripped automatically
              </p>
            </div>
            {error && (
              <div className="bg-red-900/20 border border-red-700/50 p-2 rounded">
                <p className="font-mono text-xs text-red-400">❌ {error}</p>
              </div>
            )}
            <Button
              type="submit"
              disabled={isCreating}
              className="w-full bg-emerald-600 hover:bg-emerald-700 font-mono text-sm"
            >
              {isCreating ? '⏳ Creating...' : '🚀 Create Site'}
            </Button>
          </form>
        )}

        {/* Success Message with Snippet */}
        {newSite && (
          <div className="bg-emerald-900/20 border border-emerald-700/50 p-4 rounded space-y-3">
            <p className="font-mono text-xs text-emerald-400">✅ Site created successfully!</p>
            {isUsingFallback && (
              <div className="bg-amber-900/20 border border-amber-700/50 p-2 rounded">
                <p className="font-mono text-xs text-amber-400">
                  ⚠️ <strong>Warning:</strong> NEXT_PUBLIC_PRIMARY_DOMAIN not set. Using fallback domain: <code className="text-amber-300">{getPrimaryDomain()}</code>
                </p>
                <p className="font-mono text-xs text-amber-500/70 mt-1">
                  Set NEXT_PUBLIC_PRIMARY_DOMAIN in Vercel environment variables for production.
                </p>
              </div>
            )}
            <div>
              <label className="block font-mono text-xs text-slate-300 mb-2">
                Install Snippet:
              </label>
              <div className="flex gap-2">
                <code className="flex-1 px-3 py-2 bg-slate-900/50 border border-slate-700 rounded text-slate-200 font-mono text-xs break-all">
                  {`<script defer src="https://assets.${getPrimaryDomain()}/assets/core.js" data-site-id="${newSite.public_id}" data-api="https://console.${getPrimaryDomain()}/api/sync"></script>`}
                </code>
                <Button
                  onClick={copySnippet}
                  className="bg-slate-700 hover:bg-slate-600 font-mono text-xs whitespace-nowrap"
                  size="sm"
                >
                  {copied ? '✓ Copied' : '📋 Copy'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Sites List */}
        {sites.length === 0 ? (
          <div className="text-center py-8">
            <p className="font-mono text-sm text-slate-500">No sites yet</p>
            <p className="font-mono text-xs text-slate-600 mt-2">Add your first site to start tracking</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sites.map((site) => (
              <div
                key={site.id}
                className="bg-slate-900/50 p-3 rounded border border-slate-700/50 space-y-3"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="font-mono text-sm text-slate-200 font-semibold">
                      {site.name || 'Unnamed Site'}
                    </p>
                    <p className="font-mono text-xs text-slate-400 mt-1">
                      {site.domain}
                    </p>
                    <p className="font-mono text-xs text-slate-500 mt-1">
                      ID: <code className="text-slate-400">{site.public_id}</code>
                    </p>
                  </div>
                </div>

                {/* Install Status & Verification */}
                <div className="pt-2 border-t border-slate-700/50">
                  <div className="flex justify-between items-center mb-2">
                    <label className="block font-mono text-xs text-slate-300">
                      Install Status:
                    </label>
                    <Button
                      onClick={() => handleVerifyInstall(site.id)}
                      disabled={statusLoading[site.id]}
                      className="bg-blue-600 hover:bg-blue-700 font-mono text-xs whitespace-nowrap"
                      size="sm"
                    >
                      {statusLoading[site.id] ? '⏳' : '🔍 Verify Install'}
                    </Button>
                  </div>
                  
                  {siteStatus[site.id] && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-xs ${
                          siteStatus[site.id].status === 'Receiving events' 
                            ? 'text-emerald-400' 
                            : 'text-slate-400'
                        }`}>
                          {siteStatus[site.id].status === 'Receiving events' ? '✅' : '⚠️'} {siteStatus[site.id].status}
                        </span>
                      </div>
                      
                      {siteStatus[site.id].last_event_at ? (
                        <div className="text-xs space-y-1">
                          <p className="font-mono text-slate-400">
                            Last event: <span className="text-slate-300">
                              {formatTimestamp(siteStatus[site.id].last_event_at!)}
                            </span>
                          </p>
                          {siteStatus[site.id].last_session_id && (
                            <p className="font-mono text-slate-400">
                              Session: <span className="text-slate-300 font-mono text-xs">
                                {siteStatus[site.id].last_session_id?.slice(0, 8)}...
                              </span>
                            </p>
                          )}
                          {siteStatus[site.id].last_source && (
                            <p className="font-mono text-slate-400">
                              Source: <span className="text-slate-300">{siteStatus[site.id].last_source}</span>
                            </p>
                          )}
                          {siteStatus[site.id].last_event_category && (
                            <p className="font-mono text-slate-400">
                              Category: <span className="text-slate-300">{siteStatus[site.id].last_event_category}</span>
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="font-mono text-xs text-slate-500">
                          No events recorded yet
                        </p>
                      )}
                    </div>
                  )}

                  {/* Install Instructions */}
                  <div className="mt-3 pt-3 border-t border-slate-700/30">
                    <p className="font-mono text-xs text-slate-400 mb-2">Install Snippet:</p>
                    <code className="block px-2 py-1 bg-slate-900/50 border border-slate-700 rounded text-slate-200 font-mono text-xs break-all">
                      {`<script defer src="https://assets.${getPrimaryDomain()}/assets/core.js" data-site-id="${site.public_id}" data-api="https://console.${getPrimaryDomain()}/api/sync"></script>`}
                    </code>
                    <p className="font-mono text-xs text-slate-500 mt-2">
                      📋 Copy this snippet and paste it in your WordPress header (Theme → Theme Editor → header.php) or use a plugin like "Insert Headers and Footers"
                    </p>
                    <p className="font-mono text-xs text-amber-400 mt-1">
                      ⚠️ Ensure <code className="text-amber-300">ALLOWED_ORIGINS</code> includes your WordPress domain in server environment variables.
                    </p>
                  </div>
                </div>

                {/* Invite Customer Form */}
                <div className="pt-2 border-t border-slate-700/50">
                  <label className="block font-mono text-xs text-slate-300 mb-2">
                    Invite Customer:
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={inviteEmail[site.id] || ''}
                      onChange={(e) => setInviteEmail({ ...inviteEmail, [site.id]: e.target.value })}
                      placeholder="customer@example.com"
                      className="flex-1 px-3 py-2 bg-slate-800/50 border border-slate-700 rounded text-slate-200 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    />
                    <Button
                      onClick={() => handleInvite(site.id)}
                      disabled={inviteLoading[site.id] || !inviteEmail[site.id]?.trim()}
                      className="bg-emerald-600 hover:bg-emerald-700 font-mono text-xs whitespace-nowrap"
                      size="sm"
                    >
                      {inviteLoading[site.id] ? '⏳' : '📧 Invite'}
                    </Button>
                  </div>
                  
                  {inviteError[site.id] && (
                    <div className="mt-2 bg-red-900/20 border border-red-700/50 p-2 rounded">
                      <p className="font-mono text-xs text-red-400">❌ {inviteError[site.id]}</p>
                    </div>
                  )}

                  {inviteSuccess[site.id] && (
                    <div className="mt-2 bg-emerald-900/20 border border-emerald-700/50 p-2 rounded space-y-2">
                      <p className="font-mono text-xs text-emerald-400">✅ {inviteSuccess[site.id].message}</p>
                      {inviteSuccess[site.id].loginUrl && (
                        <div>
                          <p className="font-mono text-xs text-slate-300 mb-1">Login URL:</p>
                          <code className="block px-2 py-1 bg-slate-900/50 border border-slate-700 rounded text-slate-200 font-mono text-xs break-all">
                            {inviteSuccess[site.id].loginUrl}
                          </code>
                        </div>
                      )}
                      <p className="font-mono text-xs text-slate-500">
                        ⚠️ Site ownership will be transferred to customer. Page will reload in 2 seconds.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
