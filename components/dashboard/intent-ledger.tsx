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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
  /**
   * Phase B3: quick client-side filter (e.g. last 60m) over already fetched intents.
   * When provided, intents with timestamp < minTimestampIso are excluded.
   */
  minTimestampIso?: string | null;
}

export function IntentLedger({ siteId, dateRange, minTimestampIso }: IntentLedgerProps) {
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
    onDataFreshness: () => {
      // Ads-only mode: if realtime payload can't be classified, hook triggers refetch-only via onDataFreshness
      refetch();
    },
  }, { adsOnly: true });

  // Phase B3: quick filter base set (client-side, no extra RPC)
  const baseIntents = useMemo(() => {
    if (!Array.isArray(intents)) return [];
    if (!minTimestampIso) return intents;
    const minMs = new Date(minTimestampIso).getTime();
    if (Number.isNaN(minMs)) return intents;
    return intents.filter((i) => {
      const tsMs = new Date(i.timestamp).getTime();
      if (Number.isNaN(tsMs)) return true;
      return tsMs >= minMs;
    });
  }, [intents, minTimestampIso]);

  // Filter intents (status + search) on top of baseIntents
  const filteredIntents = useMemo(() => {
    if (!Array.isArray(baseIntents)) return [];
    return baseIntents.filter(intent => {
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
  }, [baseIntents, filter, search]);

  // Status counts
  // FIX 3: Defensive rendering - ensure intents is array
  const statusCounts = useMemo(() => {
    if (!Array.isArray(baseIntents)) {
      return { pending: 0, sealed: 0, junk: 0, suspicious: 0 };
    }
    return {
      pending: baseIntents.filter(i => i.status === 'intent' || i.status === null).length,
      sealed: baseIntents.filter(i => ['confirmed', 'qualified', 'real'].includes(i.status || '')).length,
      junk: baseIntents.filter(i => i.status === 'junk').length,
      suspicious: baseIntents.filter(i => i.status === 'suspicious').length,
    };
  }, [baseIntents]);

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
    <Card>
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold">Niyet defteri</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Tüm niyetler, tıklamalar ve dönüşümler</p>
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
                  className="h-9 px-3 text-sm"
                >
                  {getStatusLabel(status)}
                  <span className="ml-2 px-2 py-0.5 rounded bg-muted text-sm text-muted-foreground tabular-nums">
                    {statusCounts[status]}
                  </span>
                </Button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Sayfada ara..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-10 pr-10 text-sm bg-background border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring w-60"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {error ? (
          <div className="p-12 text-center">
              <p className="text-destructive text-sm mb-2">Hata: {error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
            >
              Tekrar Dene
            </Button>
          </div>
        ) : loading ? (
          <div className="p-12 text-center">
            <div className="inline-block h-4 w-4 border-2 border-border border-t-muted-foreground rounded-full animate-spin mb-2" />
            <p className="text-muted-foreground text-sm uppercase tracking-widest">
              Yükleniyor...
            </p>
          </div>
        ) : filteredIntents.length === 0 ? (
          <div className="p-12 text-center">
            <Inbox className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-sm font-semibold text-foreground mb-2">
              {filter === 'all' ? 'Henüz niyet yok' : 'Bu filtrelere uygun niyet yok'}
            </h3>
            <p className="text-sm text-muted-foreground italic">
              {filter === 'pending'
                ? 'Telefon veya WhatsApp tıklamaları burada görünecek'
                : 'İlk ziyaretçileriniz geldiğinde burada göreceksiniz'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="text-sm">Time</TableHead>
                  <TableHead className="text-sm">Type</TableHead>
                  <TableHead className="text-sm">Page</TableHead>
                  <TableHead className="text-sm">City/Device</TableHead>
                  <TableHead className="text-sm">Status</TableHead>
                  <TableHead className="text-sm">Confidence</TableHead>
                  <TableHead className="text-sm"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredIntents.map((intent) => (
                  <TableRow
                    key={intent.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedIntent(intent)}
                  >
                    <TableCell>
                      {/* FIX 2: Ensure timestamp is string before formatting */}
                      <div className="text-sm tabular-nums" suppressHydrationWarning>
                        {formatTimestamp(intent?.timestamp || null, { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5 tabular-nums" suppressHydrationWarning>
                        {formatTimestamp(intent?.timestamp || null, { day: '2-digit', month: 'short' })}
                      </div>
                    </TableCell>
                    <TableCell>
                      <IntentTypeBadge type={intent.type} />
                    </TableCell>
                    <TableCell>
                      <div className="max-w-xs truncate text-sm">
                        {intent.page_url ? (() => {
                          try {
                            return new URL(intent.page_url).pathname;
                          } catch {
                            return intent.page_url;
                          }
                        })() : 'N/A'}
                      </div>
                      <div className="text-sm text-muted-foreground truncate max-w-xs">
                        {intent.page_url || ''}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {intent.city || 'Bilinmiyor'}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {intent.device_type || 'N/A'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <IntentStatusBadge
                        status={intent.status}
                        sealedAt={intent.sealed_at}
                      />
                    </TableCell>
                    <TableCell>
                      <ConfidenceScore score={intent.confidence_score} />
                    </TableCell>
                    <TableCell>
                      {intent.matched_session_id && (
                        <span className="inline-flex items-center px-2 py-1 rounded border border-border bg-muted text-sm text-muted-foreground">
                          Görüşme Var
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
