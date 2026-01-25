'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

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
          placeholder="Search by name, domain, public_id, or owner ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-4 py-2 bg-slate-800/60 border border-slate-700/50 rounded text-slate-200 placeholder:text-slate-500 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-600"
        />
      </div>

      {filteredSites.length === 0 ? (
        <div className="text-center py-8">
          <p className="font-mono text-sm text-slate-500">
            {searchQuery ? 'No sites match your search' : 'No sites found'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-left p-3 font-mono text-xs text-slate-400">Site Name</th>
                <th className="text-left p-3 font-mono text-xs text-slate-400">Domain</th>
                <th className="text-left p-3 font-mono text-xs text-slate-400">Public ID</th>
                <th className="text-left p-3 font-mono text-xs text-slate-400">Owner ID</th>
                <th className="text-left p-3 font-mono text-xs text-slate-400">Last Event</th>
                <th className="text-left p-3 font-mono text-xs text-slate-400">Status</th>
                <th className="text-left p-3 font-mono text-xs text-slate-400">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredSites.map((site) => (
                <tr key={site.id} className="border-b border-slate-800/30 hover:bg-slate-800/20">
                  <td className="p-3 font-mono text-sm text-slate-200">
                    {site.name || '—'}
                  </td>
                  <td className="p-3 font-mono text-sm text-slate-300">
                    {site.domain || '—'}
                  </td>
                  <td className="p-3 font-mono text-xs text-slate-400">
                    {site.public_id}
                  </td>
                  <td className="p-3 font-mono text-xs text-slate-500">
                    {site.user_id.slice(0, 8)}...
                  </td>
                  <td className="p-3 font-mono text-xs text-slate-400">
                    {site.last_event_at 
                      ? new Date(site.last_event_at).toLocaleString()
                      : '—'}
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded text-xs font-mono ${
                        site.status === 'Receiving events'
                          ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-700/50'
                          : 'bg-slate-800/50 text-slate-500 border border-slate-700/50'
                      }`}
                    >
                      {site.status}
                    </span>
                  </td>
                  <td className="p-3">
                    <Link href={`/dashboard/site/${site.id}`}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="font-mono text-xs bg-slate-800/60 border-slate-700/50 text-slate-200 hover:bg-slate-700/60"
                      >
                        Open Dashboard
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
