'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/useTranslation';

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

interface SitesTableWithSearchProps {
  sites: SiteWithStatus[];
}

export function SitesTableWithSearch({ sites }: SitesTableWithSearchProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSites = useMemo(() => {
    if (!searchQuery.trim()) {
      return sites;
    }

    const query = searchQuery.toLowerCase();
    return sites.filter(
      (site) =>
        site.name?.toLowerCase().includes(query) ||
        site.domain?.toLowerCase().includes(query) ||
        site.public_id.toLowerCase().includes(query) ||
        site.user_id.toLowerCase().includes(query)
    );
  }, [sites, searchQuery]);

  return (
    <>
      {/* Search Input */}
      <div className="mb-4">
        <input
          type="text"
          placeholder={t('admin.sites.table.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-4 py-2 bg-background border border-border rounded text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {filteredSites.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">
            {searchQuery ? t('common.noResults') : t('admin.sites.empty')}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left p-3 text-xs text-muted-foreground">{t('admin.sites.table.name')}</th>
                <th className="text-left p-3 text-xs text-muted-foreground">{t('admin.sites.table.domain')}</th>
                <th className="text-left p-3 text-xs text-muted-foreground">{t('admin.sites.table.publicId')}</th>
                <th className="text-left p-3 text-xs text-muted-foreground">{t('admin.sites.table.ownerId')}</th>
                <th className="text-left p-3 text-xs text-muted-foreground">{t('admin.sites.table.lastEvent')}</th>
                <th className="text-left p-3 text-xs text-muted-foreground">{t('admin.sites.table.status')}</th>
                <th className="text-left p-3 text-xs text-muted-foreground">{t('admin.sites.table.action')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredSites.map((site) => (
                <tr key={site.id} className="border-b border-border hover:bg-muted/50">
                  <td className="p-3 text-sm text-foreground">
                    {site.name || '—'}
                  </td>
                  <td className="p-3 text-sm text-muted-foreground">
                    {site.domain || '—'}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground tabular-nums">
                    {site.public_id}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground tabular-nums">
                    {site.owner_email || `${site.user_id.slice(0, 8)}...`}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground tabular-nums">
                    {site.last_event_at
                      ? new Date(site.last_event_at).toLocaleString()
                      : '—'}
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded text-xs border ${site.status === 'Receiving events'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-muted text-muted-foreground border-border'
                        }`}
                    >
                      {site.status === 'Receiving events'
                        ? t('admin.sites.status.receiving')
                        : t('admin.sites.status.noTraffic')}
                    </span>
                  </td>
                  <td className="p-3">
                    <Link href={`/dashboard/site/${site.id}`}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                      >
                        {t('admin.sites.openDashboard')}
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
