'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Check, AlertTriangle, Rocket, Search, Loader2, CheckCircle2, Mail } from 'lucide-react';
import { formatTimestamp } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  DEFAULT_SITE_COUNTRY,
  DEFAULT_SITE_CURRENCY,
  DEFAULT_SITE_LOCALE,
  DEFAULT_SITE_TIMEZONE,
  SITE_COUNTRY_OPTIONS,
  SITE_CURRENCY_OPTIONS,
  SITE_LOCALE_OPTIONS,
  SITE_TIMEZONE_OPTIONS,
} from '@/lib/validation/site-create';

interface Site {
  id: string;
  name: string | null;
  domain: string;
  public_id: string;
}

export function SitesManager() {
  const { t } = useTranslation();
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
  const [locale, setLocale] = useState<string>(DEFAULT_SITE_LOCALE);
  const [countryIso, setCountryIso] = useState<string>(DEFAULT_SITE_COUNTRY);
  const [timezone, setTimezone] = useState<string>(DEFAULT_SITE_TIMEZONE);
  const [currency, setCurrency] = useState<string>(DEFAULT_SITE_CURRENCY);

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
  const [fullEmbedBySite, setFullEmbedBySite] = useState<Record<string, string>>({});
  const [fullEmbedLoading, setFullEmbedLoading] = useState<Record<string, boolean>>({});

  const fetchSites = useCallback(async () => {
    try {
      const response = await fetch('/api/sites/list', {
        method: 'GET',
        credentials: 'include',
      });
      const payloadUnknown = await response.json().catch(() => ({}));
      const payload =
        payloadUnknown && typeof payloadUnknown === 'object' && !Array.isArray(payloadUnknown)
          ? (payloadUnknown as Record<string, unknown>)
          : {};

      if (!response.ok) {
        const code = typeof payload.code === 'string' ? payload.code : '';
        if (code === 'SCHEMA_MISMATCH') {
          setError(t('sites.schemaMismatchFullDesc'));
        } else {
          setError(t('sites.errorLoading'));
        }
        return;
      }

      const sitesData = Array.isArray(payload.sites) ? (payload.sites as Site[]) : [];
      setSites(sitesData);
      setError(null);
    } catch (error) {
      console.error('[SITES_MANAGER] Error fetching sites:', error);
      setError(t('sites.errorLoading'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  // Fetch sites
  useEffect(() => {
    void fetchSites();
  }, [fetchSites]);

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
          locale,
          default_country_iso: countryIso,
          timezone,
          currency,
        }),
      });

      const dataUnknown = await response.json();
      const data =
        dataUnknown && typeof dataUnknown === 'object' && !Array.isArray(dataUnknown)
          ? (dataUnknown as Record<string, unknown>)
          : {};

      if (!response.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : t('sites.createFailed'));
      }

      // Add new site to list
      const createdSite =
        data.site && typeof data.site === 'object' && !Array.isArray(data.site)
          ? (data.site as Site)
          : null;
      if (!createdSite) {
        throw new Error(t('sites.createFailed'));
      }
      setSites((prev) => [createdSite, ...prev]);
      setNewSite(createdSite);
      setSiteName('');
      setDomain('');
      setLocale(DEFAULT_SITE_LOCALE);
      setCountryIso(DEFAULT_SITE_COUNTRY);
      setTimezone(DEFAULT_SITE_TIMEZONE);
      setCurrency(DEFAULT_SITE_CURRENCY);
      setShowAddForm(false);
    } catch (err: unknown) {
      console.error('[SITES_MANAGER] Error:', err);
      setError(t('sites.createFailed'));
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
      setInviteError((prev) => ({ ...prev, [siteId]: t('sites.inviteEmailRequired') }));
      return;
    }

    setInviteLoading((prev) => ({ ...prev, [siteId]: true }));
    setInviteError((prev) => ({ ...prev, [siteId]: '' }));
    setInviteSuccess((prev) => ({ ...prev, [siteId]: { loginUrl: null, message: '' } }));

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

      const dataUnknown = await response.json();
      const data =
        dataUnknown && typeof dataUnknown === 'object' && !Array.isArray(dataUnknown)
          ? (dataUnknown as Record<string, unknown>)
          : {};

      if (!response.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : t('sites.inviteFailed'));
      }

      setInviteSuccess((prev) => ({
        ...prev,
        [siteId]: {
          loginUrl: typeof data.login_url === 'string' ? data.login_url : null,
          message: t('sites.inviteSuccess'),
        },
      }));
      setInviteEmail((prev) => ({ ...prev, [siteId]: '' }));

      // No reload needed: inviting a customer creates/updates a membership record, not site ownership.
      // Still refetch sites as a best-effort to keep UI consistent if the query changes later.
      void fetchSites();
    } catch (err: unknown) {
      console.error('[SITES_MANAGER] Invite error:', err);
      setInviteError((prev) => ({ ...prev, [siteId]: t('sites.inviteFailed') }));
    } finally {
      setInviteLoading((prev) => ({ ...prev, [siteId]: false }));
    }
  };

  // Handle install verification
  const handleVerifyInstall = async (siteId: string) => {
    setStatusLoading((prev) => ({ ...prev, [siteId]: true }));

    try {
      const response = await fetch(`/api/sites/${siteId}/status`);
      const dataUnknown = await response.json();
      const data =
        dataUnknown && typeof dataUnknown === 'object' && !Array.isArray(dataUnknown)
          ? (dataUnknown as Record<string, unknown>)
          : {};

      if (!response.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : t('sites.failedToVerifyInstall'));
      }

      setSiteStatus({
        ...siteStatus,
        [siteId]: {
          status: typeof data.status === 'string' ? data.status : t('misc.error'),
          last_event_at: typeof data.last_event_at === 'string' ? data.last_event_at : null,
          last_session_id: typeof data.last_session_id === 'string' ? data.last_session_id : null,
          last_source: typeof data.last_source === 'string' ? data.last_source : null,
          last_event_category: typeof data.last_event_category === 'string' ? data.last_event_category : null,
          last_event_action: typeof data.last_event_action === 'string' ? data.last_event_action : null,
        },
      });
    } catch (err: unknown) {
      console.error('[SITES_MANAGER] Status check error:', err);
      setSiteStatus({
        ...siteStatus,
        [siteId]: {
          status: t('misc.error'),
          last_event_at: null,
          last_session_id: null,
          last_source: null,
          last_event_category: null,
          last_event_action: null,
        },
      });
    } finally {
      setStatusLoading((prev) => ({ ...prev, [siteId]: false }));
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
    const snippet = `<script defer src="https://assets.${domain}/assets/core.js?v=4" data-ops-site-id="${newSite.public_id}" data-ops-consent="analytics" data-api="${apiUrl}"></script>`;

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
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">{t('sites.loading')}</p>
        </CardContent>
      </Card>
    );
  }

  // Show schema mismatch error prominently if present
  if (error && error.includes('Database schema mismatch')) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t('sites.title')}</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="bg-destructive/10 border border-destructive/20 p-4 rounded space-y-3">
            <p className="flex items-center gap-2 text-sm text-destructive font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {t('sites.schemaMismatch')}
            </p>
            <p className="text-sm text-destructive">
              {error}
            </p>
            <div className="mt-3 pt-3 border-t border-destructive/20">
              <p className="text-sm text-muted-foreground mb-2">{t('sites.fixSchemaHelp')}</p>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>{t('sites.setupStep1')}</li>
                <li>{t('sites.setupStep2')}</li>
                <li>{t('sites.setupStep3')}</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle className="text-base font-semibold">{t('sites.title')}</CardTitle>
            <CardDescription className="text-sm text-muted-foreground mt-1">
              {t('sites.manageDescription')}
            </CardDescription>
          </div>
          <Button
            onClick={() => setShowAddForm(!showAddForm)}
            size="sm"
          >
            {showAddForm ? t('sites.cancel') : t('sites.addSite')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Error Display - Visible error box for fetch errors */}
        {error && !error.includes('Database schema mismatch') && (
          <div className="bg-destructive/10 border border-destructive/20 p-4 rounded space-y-2">
            <p className="text-sm text-red-700 font-semibold">
              {t('sites.errorLoading')}
            </p>
            <p className="text-sm text-red-700 wrap-break-word">
              {error}
            </p>
            <p className="text-sm text-slate-500">
              {t('dashboard.setup.checkConsole')}
            </p>
          </div>
        )}
        {/* Add Site Form */}
        {showAddForm && (
          <form onSubmit={handleSubmit} className="bg-muted/40 p-4 rounded border border-border space-y-3">
            <div>
              <label htmlFor="site-name" className="block text-sm text-muted-foreground mb-1">
                {t('sites.siteName')}
              </label>
              <input
                id="site-name"
                type="text"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                required
                className="w-full px-3 py-2 bg-background border border-border rounded text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={t('sites.siteNamePlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="domain" className="block text-sm text-muted-foreground mb-1">
                {t('sites.domain')}
              </label>
              <input
                id="domain"
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                required
                className="w-full px-3 py-2 bg-background border border-border rounded text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={t('sites.domainPlaceholder')}
              />
              <p className="text-sm text-muted-foreground mt-1">
                {t('sites.domainHelp')}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="site-locale" className="block text-sm text-muted-foreground mb-1">
                  Language
                </label>
                <select
                  id="site-locale"
                  value={locale}
                  onChange={(event) => setLocale(event.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {SITE_LOCALE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="site-country" className="block text-sm text-muted-foreground mb-1">
                  Country
                </label>
                <select
                  id="site-country"
                  value={countryIso}
                  onChange={(event) => setCountryIso(event.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {SITE_COUNTRY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="site-timezone" className="block text-sm text-muted-foreground mb-1">
                  Timezone
                </label>
                <select
                  id="site-timezone"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {SITE_TIMEZONE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="site-currency" className="block text-sm text-muted-foreground mb-1">
                  Currency
                </label>
                <select
                  id="site-currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {SITE_CURRENCY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {error && (
              <div className="bg-destructive/10 border border-destructive/20 p-2 rounded">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
            <Button
              type="submit"
              disabled={isCreating}
              className="w-full"
            >
              <Rocket className="mr-2 h-4 w-4 shrink-0" aria-hidden />
              {isCreating ? t('sites.creating') : t('sites.createSite')}
            </Button>
          </form>
        )}

        {/* Success Message with Snippet */}
        {newSite && (
          <div className="bg-emerald-50 border border-emerald-200 p-4 rounded space-y-3">
            <p className="text-sm text-emerald-700">{t('sites.createdSuccess')}</p>
            {isUsingFallback && (
              <div className="bg-amber-50 border border-amber-200 p-2 rounded">
                <p className="text-sm text-amber-800">
                  <strong>{t('common.warning')}:</strong> {t('common.envWarning')} <code className="tabular-nums">{getPrimaryDomain()}</code>
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('common.envFix')}
                </p>
              </div>
            )}
            <div>
              <label className="block text-sm text-muted-foreground mb-2">
                {t('sites.installSnippet')}
              </label>
              <div className="flex gap-2">
                <code className="flex-1 px-3 py-2 bg-background border border-border rounded text-foreground text-sm break-all">
                  {`<script defer src="https://assets.${getPrimaryDomain()}/assets/core.js?v=4" data-ops-site-id="${newSite.public_id}" data-ops-consent="analytics" data-api="https://console.${getPrimaryDomain()}/api/sync"></script>`}
                </code>
                <Button
                  onClick={copySnippet}
                  size="sm"
                >
                  {copied ? (
                    <>
                      <Check className="mr-2 h-4 w-4 shrink-0" aria-hidden />
                      {t('sites.copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4 shrink-0" aria-hidden />
                      {t('sites.copy')}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Sites List */}
        {sites.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">{t('sites.noSites')}</p>
            <p className="text-sm text-muted-foreground mt-2">{t('sites.addFirstSite')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sites.map((site) => (
              <div
                key={site.id}
                className="bg-background p-3 rounded border border-border space-y-3"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="text-sm text-foreground font-semibold">
                      {site.name || t('sites.unnamedSite')}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {site.domain}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1 tabular-nums">
                      {t('common.id')}: <code className="text-foreground">{site.public_id}</code>
                    </p>
                  </div>
                </div>

                {/* Install Status & Verification */}
                <div className="pt-2 border-t border-border">
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm text-muted-foreground">
                      {t('sites.installStatus')}
                    </label>
                    <Button
                      onClick={() => handleVerifyInstall(site.id)}
                      disabled={statusLoading[site.id]}
                      size="sm"
                    >
                      {statusLoading[site.id] ? (
                        <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden />
                      ) : (
                        <Search className="mr-2 h-4 w-4 shrink-0" aria-hidden />
                      )}
                      {t('sites.verifyInstall')}
                    </Button>
                  </div>

                  {siteStatus[site.id] && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`flex items-center gap-2 text-sm ${siteStatus[site.id].status === 'RECEIVING'
                          ? 'text-emerald-700'
                          : 'text-muted-foreground'
                          }`}>
                          {siteStatus[site.id].status === 'RECEIVING' ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                          ) : (
                            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                          )}
                          {siteStatus[site.id].status === 'RECEIVING' ? t('sites.status.receiving') : siteStatus[site.id].status === 'NO_TRAFFIC' ? t('sites.status.noTraffic') : siteStatus[site.id].status}
                        </span>
                      </div>

                      {siteStatus[site.id].last_event_at ? (
                        <div className="text-sm space-y-1">
                          <p className="text-muted-foreground tabular-nums">
                            {t('sites.lastEventAt')} <span className="text-foreground" suppressHydrationWarning>
                              {formatTimestamp(siteStatus[site.id].last_event_at!)}
                            </span>
                          </p>
                          {siteStatus[site.id].last_session_id && (
                            <p className="text-muted-foreground tabular-nums">
                              {t('session.sessionLabel')}: <span className="text-foreground text-sm">
                                {siteStatus[site.id].last_session_id?.slice(0, 8)}...
                              </span>
                            </p>
                          )}
                          {siteStatus[site.id].last_source && (
                            <p className="text-muted-foreground">
                              {t('session.source')}: <span className="text-foreground">{siteStatus[site.id].last_source}</span>
                            </p>
                          )}
                          {siteStatus[site.id].last_event_category && (
                            <p className="text-muted-foreground">
                              {t('session.eventCategory')}: <span className="text-foreground">{siteStatus[site.id].last_event_category}</span>
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {t('sites.noEventsYet')}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Install Instructions */}
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-sm text-muted-foreground mb-2">{t('sites.installSnippet')}</p>
                    <code className="block px-2 py-1 bg-muted/40 border border-border rounded text-foreground text-sm break-all">
                      {fullEmbedBySite[site.id] || `<script defer src="https://assets.${getPrimaryDomain()}/assets/core.js?v=4" data-ops-site-id="${site.public_id}" data-ops-consent="analytics" data-api="https://console.${getPrimaryDomain()}/api/sync"></script>`}
                    </code>
                    {!fullEmbedBySite[site.id] && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        disabled={fullEmbedLoading[site.id]}
                        onClick={async () => {
                          setFullEmbedLoading((prev) => ({ ...prev, [site.id]: true }));
                          try {
                            const res = await fetch(`/api/sites/${encodeURIComponent(site.id)}/tracker-embed`, { credentials: 'include' });
                            const dataUnknown = await res.json();
                            const data =
                              dataUnknown && typeof dataUnknown === 'object' && !Array.isArray(dataUnknown)
                                ? (dataUnknown as Record<string, unknown>)
                                : {};
                            const scriptTag = typeof data.scriptTag === 'string' ? data.scriptTag : null;
                            if (res.ok && scriptTag) {
                              setFullEmbedBySite((prev) => ({ ...prev, [site.id]: scriptTag }));
                            }
                          } finally {
                            setFullEmbedLoading((prev) => ({ ...prev, [site.id]: false }));
                          }
                        }}
                      >
                        {fullEmbedLoading[site.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {fullEmbedLoading[site.id] ? '...' : t('sites.loadFullEmbed')}
                      </Button>
                    )}
                    <p className="text-sm text-muted-foreground mt-2">
                      {t('sites.installInstructions')}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t('sites.allowedOriginsWarning')}
                    </p>
                    <p className="text-sm text-amber-700 mt-1">
                      {t('sites.fullEmbedForCallEvent')}
                    </p>
                  </div>
                </div>

                {/* Invite Customer Form */}
                <div className="pt-2 border-t border-border">
                  <label className="block text-sm text-muted-foreground mb-2">
                    {t('sites.inviteCustomer')}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={inviteEmail[site.id] || ''}
                      onChange={(e) => setInviteEmail((prev) => ({ ...prev, [site.id]: e.target.value }))}
                      placeholder={t('common.email')}
                      className="flex-1 px-3 py-2 bg-background border border-border rounded text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <Button
                      onClick={() => handleInvite(site.id)}
                      disabled={inviteLoading[site.id] || !inviteEmail[site.id]?.trim()}
                      size="sm"
                    >
                      {inviteLoading[site.id] ? (
                        <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden />
                      ) : (
                        <Mail className="mr-2 h-4 w-4 shrink-0" aria-hidden />
                      )}
                      {t('sites.inviteCustomer').split(':')[0]}
                    </Button>
                  </div>

                  {inviteError[site.id] && (
                    <div className="mt-2 bg-destructive/10 border border-destructive/20 p-2 rounded">
                      <p className="text-sm text-destructive">{inviteError[site.id]}</p>
                    </div>
                  )}

                  {inviteSuccess[site.id] && (
                    <div className="mt-2 bg-emerald-50 border border-emerald-200 p-2 rounded space-y-2">
                      <p className="flex items-center gap-2 text-sm text-emerald-700">
                        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                        {inviteSuccess[site.id].message}
                      </p>
                      {inviteSuccess[site.id].loginUrl && (
                        <div>
                          <p className="text-sm text-muted-foreground mb-1">{t('sites.loginUrl')}</p>
                          <code className="block px-2 py-1 bg-background border border-border rounded text-foreground text-sm break-all tabular-nums">
                            {inviteSuccess[site.id].loginUrl}
                          </code>
                        </div>
                      )}
                      <p className="text-sm text-muted-foreground">
                        {t('sites.shareLoginUrl')}
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
