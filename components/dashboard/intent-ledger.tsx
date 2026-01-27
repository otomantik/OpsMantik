/**
 * Iron Dome v2.1 - Phase 6: Intent Ledger - Lead Inbox
 * 
 * Displays all intents (calls + conversions) in a table with filtering,
 * search, and session drawer for detailed view.
 */

'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Inbox, Search, X } from 'lucide-react';
import { useIntents, IntentRow, IntentFilter } from '@/lib/hooks/use-intents';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import { DateRange } from '@/lib/hooks/use-dashboard-date-range';
import { formatTimestamp } from '@/lib/utils';
import { SessionDrawer } from './session-drawer';
import { IntentTypeBadge } from './intent-type-badge';
import { IntentStatusBadge } from './intent-status-badge';
import { ConfidenceScore } from './confidence-score';

interface IntentLedgerProps {
  siteId: string;
  dateRange: DateRange;
}

export function IntentLedger({ siteId, dateRange }: IntentLedgerProps) {
  const { intents, loading, error, refetch } = useIntents(siteId, dateRange);
  const [selectedIntent, setSelectedIntent] = useState<IntentRow | null>(null);
  const [filter, setFilter] = useState<IntentFilter>('all');
  const [search, setSearch] = useState('');

  // Realtime updates for intents
  useRealtimeDashboard(siteId, {
    onCallCreated: () => {
      // Optimistically refresh intents when new call arrives
      refetch();
    },
    onCallUpdated: () => {
      // Optimistically refresh intents when call status changes
      refetch();
    },
  });

  // Filter intents
  // FIX 3: Defensive rendering - ensure intents is array
  const filteredIntents = useMemo(() => {
    if (!Array.isArray(intents)) return [];
    return intents.filter(intent => {
      // Status filter
      if (filter !== 'all') {
        if (filter === 'pending') {
          // pending = intent or null
          if (intent.status !== 'intent' && intent.status !== null) return false;
        } else if (filter === 'sealed') {
          // sealed = confirmed, qualified, or real
          if (!['confirmed', 'qualified', 'real'].includes(intent.status || '')) return false;
        } else {
          // junk or suspicious
          if (intent.status !== filter) return false;
        }
      }

      // Search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const pageUrl = intent.page_url.toLowerCase();
        if (!pageUrl.includes(searchLower)) return false;
      }

      return true;
    });
  }, [intents, filter, search]);

  // Status counts
  // FIX 3: Defensive rendering - ensure intents is array
  const statusCounts = useMemo(() => {
    if (!Array.isArray(intents)) {
      return { pending: 0, sealed: 0, junk: 0, suspicious: 0 };
    }
    return {
      pending: intents.filter(i => i.status === 'intent' || i.status === null).length,
      sealed: intents.filter(i => ['confirmed', 'qualified', 'real'].includes(i.status || '')).length,
      junk: intents.filter(i => i.status === 'junk').length,
      suspicious: intents.filter(i => i.status === 'suspicious').length,
    };
  }, [intents]);

  const getStatusLabel = (status: IntentFilter) => {
    switch (status) {
      case 'pending': return 'Bekleyen';
      case 'sealed': return 'Kapanan';
      case 'junk': return 'Çöp';
      case 'suspicious': return 'Şüpheli';
      default: return 'Tümü';
    }
  };

  return (
    <Card className="glass border-slate-800/50">
      <CardHeader className="pb-3 border-b border-slate-800/20">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-mono text-slate-200 uppercase tracking-tighter">
              Niyet Defteri
            </CardTitle>
            <p className="text-[10px] font-mono text-slate-500 mt-1 uppercase tracking-wider">
              Tüm niyetler, tıklamalar ve dönüşümler
            </p>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              {(['pending', 'sealed', 'junk', 'suspicious'] as const).map((status) => (
                <Button
                  key={status}
                  variant={filter === status ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilter(status)}
                  className={`h-7 px-2 text-[10px] font-mono ${
                    filter === status
                      ? 'bg-slate-700 text-slate-200 border-slate-600'
                      : 'bg-slate-800/30 text-slate-400 border-slate-700/50 hover:bg-slate-700/50'
                  }`}
                >
                  {getStatusLabel(status)}
                  <span className="ml-1.5 px-1 py-0.5 rounded bg-slate-600/50 text-[9px]">
                    {statusCounts[status]}
                  </span>
                </Button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" />
              <input
                type="text"
                placeholder="Sayfada ara..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 pl-7 pr-8 text-[10px] font-mono bg-slate-800/30 border border-slate-700/50 rounded text-slate-300 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-600 w-48"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-400"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {error ? (
          <div className="p-12 text-center">
            <p className="text-rose-400 font-mono text-sm mb-2">Hata: {error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="bg-slate-800/60 border-slate-700/50 text-slate-200"
            >
              Tekrar Dene
            </Button>
          </div>
        ) : loading ? (
          <div className="p-12 text-center">
            <div className="inline-block h-4 w-4 border-2 border-slate-600 border-t-slate-400 rounded-full animate-spin mb-2" />
            <p className="text-slate-400 font-mono text-sm uppercase tracking-widest">
              Yükleniyor...
            </p>
          </div>
        ) : filteredIntents.length === 0 ? (
          <div className="p-12 text-center">
            <Inbox className="h-12 w-12 text-slate-600 mx-auto mb-4" />
            <h3 className="text-sm font-mono text-slate-300 mb-2">
              {filter === 'all' ? 'Henüz niyet yok' : 'Bu filtrelere uygun niyet yok'}
            </h3>
            <p className="text-[10px] font-mono text-slate-500 italic">
              {filter === 'pending'
                ? 'Telefon veya WhatsApp tıklamaları burada görünecek'
                : 'İlk ziyaretçileriniz geldiğinde burada göreceksiniz'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-900/50 border-b border-slate-800/30">
                <tr>
                  <th className="p-3 text-left text-[10px] font-mono text-slate-400 uppercase tracking-wider">Zaman</th>
                  <th className="p-3 text-left text-[10px] font-mono text-slate-400 uppercase tracking-wider">Tür</th>
                  <th className="p-3 text-left text-[10px] font-mono text-slate-400 uppercase tracking-wider">Sayfa</th>
                  <th className="p-3 text-left text-[10px] font-mono text-slate-400 uppercase tracking-wider">Şehir/Cihaz</th>
                  <th className="p-3 text-left text-[10px] font-mono text-slate-400 uppercase tracking-wider">Durum</th>
                  <th className="p-3 text-left text-[10px] font-mono text-slate-400 uppercase tracking-wider">Güven</th>
                  <th className="p-3 text-left text-[10px] font-mono text-slate-400 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/30">
                {filteredIntents.map((intent) => (
                  <tr
                    key={intent.id}
                    className="hover:bg-slate-800/20 cursor-pointer transition-colors"
                    onClick={() => setSelectedIntent(intent)}
                  >
                    <td className="p-3">
                      {/* FIX 2: Ensure timestamp is string before formatting */}
                      <div className="text-[11px] font-mono text-slate-200" suppressHydrationWarning>
                        {formatTimestamp(intent?.timestamp || null, { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div className="text-[9px] font-mono text-slate-500 mt-0.5" suppressHydrationWarning>
                        {formatTimestamp(intent?.timestamp || null, { day: '2-digit', month: 'short' })}
                      </div>
                    </td>
                    <td className="p-3">
                      <IntentTypeBadge type={intent.type} />
                    </td>
                    <td className="p-3">
                      <div className="max-w-xs truncate text-[11px] font-mono text-slate-300">
                        {intent.page_url ? (() => {
                          try {
                            return new URL(intent.page_url).pathname;
                          } catch {
                            return intent.page_url;
                          }
                        })() : 'N/A'}
                      </div>
                      <div className="text-[9px] font-mono text-slate-600 truncate max-w-xs">
                        {intent.page_url || ''}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="text-[11px] font-mono text-slate-300">
                        {intent.city || 'Bilinmiyor'}
                      </div>
                      <div className="text-[9px] font-mono text-slate-500">
                        {intent.device_type || 'N/A'}
                      </div>
                    </td>
                    <td className="p-3">
                      <IntentStatusBadge
                        status={intent.status}
                        sealedAt={intent.sealed_at}
                      />
                    </td>
                    <td className="p-3">
                      <ConfidenceScore score={intent.confidence_score} />
                    </td>
                    <td className="p-3">
                      {intent.matched_session_id && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-slate-700/50 bg-slate-800/30 text-[9px] font-mono text-slate-400">
                          Görüşme Var
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {/* Session Drawer */}
      {selectedIntent && (
        <SessionDrawer
          intent={selectedIntent}
          siteId={siteId}
          onClose={() => setSelectedIntent(null)}
          onStatusChange={async (newStatus) => {
            if (!selectedIntent) return;
            
            try {
              const response = await fetch(`/api/intents/${selectedIntent.id}/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
              });

              if (!response.ok) {
                throw new Error('Failed to update status');
              }

              await refetch();
            } catch (err) {
              console.error('[IntentLedger] Status update error:', err);
            }
          }}
        />
      )}
    </Card>
  );
}
