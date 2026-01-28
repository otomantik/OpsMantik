'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet';
import { Icons } from '@/components/icons';
import { IntentQualificationCard, type IntentForQualification } from './IntentQualificationCard';
import { LazySessionDrawer } from '@/components/dashboard/lazy-session-drawer';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import { formatTimestamp } from '@/lib/utils';

interface QualificationQueueProps {
  siteId: string;
}

function parseRpcJsonbArray<T>(data: unknown): T[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    if (data.length === 0) return [];
    if (typeof data[0] === 'object' && data[0] !== null && !Array.isArray(data[0])) {
      return data as T[];
    }
    if (typeof data[0] === 'string') {
      const out: T[] = [];
      for (const item of data as string[]) {
        try {
          const parsed = JSON.parse(item);
          if (parsed && typeof parsed === 'object') out.push(parsed as T);
        } catch {
          // ignore
        }
      }
      return out;
    }
  }
  return [];
}

export function QualificationQueue({ siteId }: QualificationQueueProps) {
  const [intents, setIntents] = useState<IntentForQualification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIntent, setSelectedIntent] = useState<IntentForQualification | null>(null);
  const [qualifyIntent, setQualifyIntent] = useState<IntentForQualification | null>(null);

  const fetchUnscoredIntents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const supabase = createClient();

      // Source of truth: use the same RPC pipeline as LiveInbox to avoid schema/RLS drift.
      // Pull "today-like" window (up to 24h) then filter client-side to unscored.
      const { data, error: fetchError } = await supabase.rpc('get_recent_intents_v1', {
        p_site_id: siteId,
        p_since: null,
        p_minutes_lookback: 24 * 60,
        p_limit: 500,
        p_ads_only: true,
      });

      if (fetchError) {
        throw fetchError;
      }

      const rows = parseRpcJsonbArray<any>(data);
      const unscored = rows.filter((r) => {
        const status = (r?.status ?? null) as string | null;
        const leadScore = (r?.lead_score ?? null) as number | null;
        const statusOk = status === null || String(status).toLowerCase() === 'intent';
        const scoreOk = leadScore === null || Number(leadScore) === 0;
        return statusOk && scoreOk;
      });

      setIntents(
        unscored.map((r) => ({
          id: r.id,
          created_at: r.created_at,
          intent_action: r.intent_action,
          intent_target: r.intent_target,
          intent_page_url: r.intent_page_url,
          matched_session_id: r.matched_session_id,
          lead_score: r.lead_score ?? null,
          status: r.status ?? null,
          click_id: r.click_id ?? null,
        })) as IntentForQualification[]
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to load intents');
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  // Initial fetch
  useEffect(() => {
    fetchUnscoredIntents();
  }, [fetchUnscoredIntents]);

  // Realtime updates: refetch when new intents arrive
  useRealtimeDashboard(
    siteId,
    {
      onCallCreated: () => {
        fetchUnscoredIntents();
      },
      onCallUpdated: () => {
        fetchUnscoredIntents();
      },
    },
    { adsOnly: true }
  );

  const handleQualified = useCallback(() => {
    // Intent was qualified, refresh the list
    fetchUnscoredIntents();
    setQualifyIntent(null);
  }, [fetchUnscoredIntents]);

  const handleOpenSession = useCallback((intent: IntentForQualification) => {
    setSelectedIntent(intent);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setSelectedIntent(null);
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">
            Intent Qualification Queue
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border border-rose-200 bg-rose-50">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Icons.alert className="w-10 h-10 text-rose-600 mb-2" />
          <p className="text-rose-800 text-sm mb-4">Failed to load intents: {error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchUnscoredIntents()}
            className="bg-background border-rose-300 text-rose-800 hover:bg-rose-100"
          >
            <Icons.refresh className="w-3 h-3 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (intents.length === 0) {
    return (
      <>
        <Card className="border-2 border-dashed border-border bg-muted/20">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Icons.check className="w-16 h-16 text-green-500 mb-4" />
            <h3 className="text-xl font-semibold mb-2">All Caught Up!</h3>
            <p className="text-muted-foreground max-w-md">
              No pending intents to qualify. New intents from Google Ads will appear here automatically.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchUnscoredIntents()}
              className="mt-4"
            >
              <Icons.refresh className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </CardContent>
        </Card>

        {/* Session Drawer */}
        {selectedIntent && selectedIntent.matched_session_id && (
          <LazySessionDrawer
            siteId={siteId}
            intent={{
              id: selectedIntent.id,
              created_at: selectedIntent.created_at,
              intent_action: selectedIntent.intent_action,
              intent_target: selectedIntent.intent_target,
              intent_page_url: selectedIntent.intent_page_url,
              intent_stamp: null,
              matched_session_id: selectedIntent.matched_session_id,
              lead_score: selectedIntent.lead_score,
              status: selectedIntent.status,
              click_id: selectedIntent.click_id,
            }}
            onClose={handleCloseDrawer}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Sheet defaultOpen={false}>
        <Card>
          <CardHeader className="py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base font-semibold leading-none">
                  Qualification Queue
                </CardTitle>
                <div className="mt-1 text-sm text-muted-foreground">
                  Score and seal Ads intents (dense view)
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-200">
                  {intents.length} Pending
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => fetchUnscoredIntents()}
                  title="Refresh"
                >
                  <Icons.refresh className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-background">
                  <TableHead className="w-[140px]">Time (TRT)</TableHead>
                  <TableHead className="w-[120px]">Type</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead className="hidden lg:table-cell">Page</TableHead>
                  <TableHead className="hidden lg:table-cell w-[160px]">Click ID</TableHead>
                  <TableHead className="w-[220px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {intents.map((intent) => {
                  const type = (intent.intent_action || '').toLowerCase();
                  const typeBadge =
                    type === 'phone' ? (
                      <Badge className="bg-blue-100 text-blue-700 border-blue-200">
                        <Icons.phone className="w-3 h-3 mr-1" />
                        Phone
                      </Badge>
                    ) : type === 'whatsapp' ? (
                      <Badge className="bg-green-100 text-green-700 border-green-200">
                        <Icons.whatsappBrand className="w-3 h-3 mr-1" />
                        WhatsApp
                      </Badge>
                    ) : type === 'form' ? (
                      <Badge className="bg-purple-100 text-purple-700 border-purple-200">
                        <Icons.form className="w-3 h-3 mr-1" />
                        Form
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <Icons.circleDot className="w-3 h-3 mr-1" />
                        Other
                      </Badge>
                    );

                  const shortTarget = intent.intent_target
                    ? (intent.intent_target.length > 18 ? `${intent.intent_target.slice(0, 15)}…` : intent.intent_target)
                    : '—';
                  const shortPage = intent.intent_page_url
                    ? (intent.intent_page_url.length > 34 ? `${intent.intent_page_url.slice(0, 31)}…` : intent.intent_page_url)
                    : '—';
                  const shortClick = intent.click_id
                    ? (intent.click_id.length > 14 ? `${intent.click_id.slice(0, 12)}…` : intent.click_id)
                    : '—';

                  return (
                    <TableRow key={intent.id}>
                      <TableCell className="tabular-nums whitespace-nowrap">
                        {formatTimestamp(intent.created_at, { hour: '2-digit', minute: '2-digit' })}
                      </TableCell>
                      <TableCell>{typeBadge}</TableCell>
                      <TableCell className="min-w-0">
                        <span className="truncate">{shortTarget}</span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="truncate text-muted-foreground">{shortPage}</span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell font-mono text-sm text-muted-foreground">
                        {shortClick}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-2">
                          {intent.matched_session_id && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => handleOpenSession(intent)}
                            >
                              <Icons.externalLink className="w-3 h-3 mr-2" />
                              Session
                            </Button>
                          )}
                          <Button
                            variant="default"
                            size="sm"
                            className="h-8"
                            onClick={() => setQualifyIntent(intent)}
                          >
                            <Icons.star className="w-4 h-4 mr-2" />
                            Qualify
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <SheetContent side="right" className="w-[560px] max-w-[95vw] p-0">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-4 py-3">
            <div className="text-sm font-semibold">Qualify intent</div>
            <SheetClose className="cursor-pointer">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Icons.x className="h-4 w-4" />
              </Button>
            </SheetClose>
          </div>
          <div className="p-4">
            {qualifyIntent ? (
              <IntentQualificationCard
                siteId={siteId}
                intent={qualifyIntent}
                onQualified={handleQualified}
                onOpenSession={handleOpenSession}
              />
            ) : (
              <div className="text-sm text-muted-foreground">Select an intent to qualify.</div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Session Drawer */}
      {selectedIntent && selectedIntent.matched_session_id && (
        <LazySessionDrawer
          siteId={siteId}
          intent={{
            id: selectedIntent.id,
            created_at: selectedIntent.created_at,
            intent_action: selectedIntent.intent_action,
            intent_target: selectedIntent.intent_target,
            intent_page_url: selectedIntent.intent_page_url,
            intent_stamp: null,
            matched_session_id: selectedIntent.matched_session_id,
            lead_score: selectedIntent.lead_score,
            status: selectedIntent.status,
            click_id: selectedIntent.click_id,
          }}
          onClose={handleCloseDrawer}
        />
      )}
    </>
  );
}
