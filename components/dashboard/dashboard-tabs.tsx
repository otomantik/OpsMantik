/**
 * Phase B2: Dashboard tabs (Live/Today/Custom)
 *
 * Rules:
 * - tab state persists in URL (?tab=live|today|custom)
 * - DateRangePicker visible in Today/Custom; hidden in Live
 * - Keep caches per tab by keeping tab contents mounted and maintaining per-tab ranges
 */

'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DateRangePicker } from './date-range-picker';
import { StatsCards } from './stats-cards';
import { TimelineChart } from './timeline-chart';
import { IntentLedger } from './intent-ledger';
import { LiveFeed } from './live-feed';
import { LiveInbox } from './live-inbox';
import type { DateRange, DateRangePreset } from '@/lib/hooks/use-dashboard-date-range';
import { getTodayTrtUtcRange } from '@/lib/time/today-range';
import { Button } from '@/components/ui/button';

type DashboardTab = 'live' | 'today' | 'custom';
type TodayQuickFilter = 'all' | '60m';

function parseUrlRange(from: string | null, to: string | null): DateRange | null {
  if (!from || !to) return null;
  const f = new Date(from);
  const t = new Date(to);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return null;
  return { from: f, to: t };
}

function rangeToIso(range: DateRange): { fromIso: string; toIso: string } {
  return { fromIso: range.from.toISOString(), toIso: range.to.toISOString() };
}

const CUSTOM_RANGE_STORAGE_KEY = 'opsmantik_dashboard_custom_range_v1';

export function DashboardTabs({ siteId }: { siteId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabParam = (searchParams.get('tab') as DashboardTab | null) ?? 'today';
  const tab: DashboardTab = tabParam === 'live' || tabParam === 'custom' ? tabParam : 'today';

  // URL range is always present after Phase B1 redirect (defensive parse anyway).
  const urlRange = useMemo(() => parseUrlRange(searchParams.get('from'), searchParams.get('to')), [searchParams]);

  // Per-tab ranges (cache per tab; tabs stay mounted)
  const [todayRange, setTodayRange] = useState<DateRange | null>(null);
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const [todayQuick, setTodayQuick] = useState<TodayQuickFilter>('all');
  const [todayMinIso, setTodayMinIso] = useState<string | null>(null);

  // One-time init from URL + sessionStorage.
  useEffect(() => {
    if (!todayRange) {
      // Prefer server-provided URL range (avoids hydration mismatch); fallback to local compute.
      if (urlRange) setTodayRange(urlRange);
      else {
        const { fromIso, toIso } = getTodayTrtUtcRange();
        setTodayRange({ from: new Date(fromIso), to: new Date(toIso) });
      }
    }

    if (!customRange) {
      if (tab === 'custom' && urlRange) {
        setCustomRange(urlRange);
        return;
      }
      try {
        const raw = window.sessionStorage.getItem(CUSTOM_RANGE_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { fromIso: string; toIso: string };
          const r = parseUrlRange(parsed.fromIso, parsed.toIso);
          if (r) setCustomRange(r);
        }
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase B3: "Last 60m" quick filter inside Today (client-side only, no extra RPC).
  useEffect(() => {
    if (tab !== 'today' || todayQuick !== '60m') {
      setTodayMinIso(null);
      return;
    }
    const update = () => {
      const now = Date.now();
      const min = new Date(now - 60 * 60 * 1000).toISOString();
      setTodayMinIso(min);
    };
    update();
    const t = window.setInterval(update, 30_000); // bounded refresh of filter window
    return () => window.clearInterval(t);
  }, [tab, todayQuick]);

  const writeUrl = useCallback(
    (nextTab: DashboardTab, nextRange: DateRange | null) => {
      const qp = new URLSearchParams(searchParams.toString());
      qp.set('tab', nextTab);
      if (nextRange) {
        const { fromIso, toIso } = rangeToIso(nextRange);
        qp.set('from', fromIso);
        qp.set('to', toIso);
      }
      router.replace(`/dashboard/site/${siteId}?${qp.toString()}`);
    },
    [router, searchParams, siteId]
  );

  const persistCustomRange = useCallback((r: DateRange) => {
    try {
      const { fromIso, toIso } = rangeToIso(r);
      window.sessionStorage.setItem(CUSTOM_RANGE_STORAGE_KEY, JSON.stringify({ fromIso, toIso }));
    } catch {
      // ignore
    }
  }, []);

  const handleTabChange = useCallback(
    (next: string) => {
      const nextTab: DashboardTab = next === 'live' || next === 'custom' ? next : 'today';

      if (nextTab === 'today') {
        // Set URL range to TRT today [from,to) (client-side, but only on interaction).
        const { fromIso, toIso } = getTodayTrtUtcRange();
        const r: DateRange = { from: new Date(fromIso), to: new Date(toIso) };
        setTodayRange(r);
        writeUrl('today', r);
        return;
      }

      if (nextTab === 'custom') {
        const r = customRange || todayRange || urlRange;
        if (r) {
          setCustomRange(r);
          persistCustomRange(r);
        }
        writeUrl('custom', r || null);
        return;
      }

      // live: keep current URL range (shareable) but do not change per-tab caches
      writeUrl('live', urlRange || todayRange || null);
    },
    [customRange, persistCustomRange, todayRange, urlRange, writeUrl]
  );

  const presets: DateRangePreset[] = useMemo(
    () => [
      { label: 'Bugün', value: 'today' },
      { label: 'Dün', value: 'yesterday' },
      { label: 'Son 7 Gün', value: '7d' },
      { label: 'Son 30 Gün', value: '30d' },
      { label: 'Bu Ay', value: 'month' },
    ],
    []
  );

  const setRangeFromPicker = useCallback(
    (r: DateRange) => {
      if (tab === 'today') {
        // Any manual selection turns Today into Custom (definition).
        setCustomRange(r);
        persistCustomRange(r);
        writeUrl('custom', r);
        return;
      }
      setCustomRange(r);
      persistCustomRange(r);
      writeUrl('custom', r);
    },
    [persistCustomRange, tab, writeUrl]
  );

  const applyPreset = useCallback(
    (presetValue: string) => {
      const now = new Date();
      let from: Date;
      let to: Date = new Date(now);
      // Half-open range: make `to` = next day start in local time, then rely on ISO
      // (Preset logic is only for Custom; Today tab is always TRT today via redirect/switch)
      to.setHours(0, 0, 0, 0);
      to = new Date(to.getTime() + 24 * 60 * 60 * 1000);

      switch (presetValue) {
        case 'today': {
          const { fromIso, toIso } = getTodayTrtUtcRange();
          setTodayRange({ from: new Date(fromIso), to: new Date(toIso) });
          writeUrl('today', { from: new Date(fromIso), to: new Date(toIso) });
          return;
        }
        case 'yesterday': {
          const { fromIso, toIso } = getTodayTrtUtcRange();
          const f = new Date(fromIso);
          const t = new Date(toIso);
          const yf = new Date(f.getTime() - 24 * 60 * 60 * 1000);
          const yt = new Date(t.getTime() - 24 * 60 * 60 * 1000);
          setRangeFromPicker({ from: yf, to: yt });
          return;
        }
        case '7d':
          from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          from = new Date(now.getFullYear(), now.getMonth(), 1);
          from.setHours(0, 0, 0, 0);
          break;
        default:
          return;
      }
      from.setHours(0, 0, 0, 0);
      setRangeFromPicker({ from, to });
    },
    [setRangeFromPicker, writeUrl]
  );

  const effectiveTodayRange = todayRange || urlRange;
  const effectiveCustomRange = customRange || (tab === 'custom' ? urlRange : null);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <Tabs value={tab} onValueChange={handleTabChange}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="live">Live (60m)</TabsTrigger>
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="custom">Custom</TabsTrigger>
            </TabsList>

            {(tab === 'today' || tab === 'custom') && (
              <div className="w-full sm:w-auto">
                <DateRangePicker
                  value={(tab === 'today' ? effectiveTodayRange : effectiveCustomRange) || (effectiveTodayRange as any)}
                  onSelect={setRangeFromPicker}
                  onPresetSelect={applyPreset}
                  presets={presets}
                  timezone="Europe/Istanbul"
                  maxRange={180}
                />
              </div>
            )}
          </div>

          {/* Live tab: source-of-truth is calls (LiveInbox) */}
          <TabsContent value="live">
            <div className="space-y-6">
              <div className="text-sm text-slate-700">
                Live view shows the last 60 minutes. Session details load lazily from the drawer.
              </div>
              <LiveInbox siteId={siteId} />
            </div>
          </TabsContent>

          {/* Today tab: KPIs + Timeline + Ledger (TRT today) */}
          <TabsContent value="today">
            <div className="space-y-6">
              {effectiveTodayRange && (
                <>
                  <StatsCards siteId={siteId} dateRange={effectiveTodayRange} adsOnly />
                  <TimelineChart siteId={siteId} dateRange={effectiveTodayRange} />
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-mono text-slate-700">Today filter:</div>
                      <Button
                        type="button"
                        variant={todayQuick === 'all' ? 'default' : 'outline'}
                        size="sm"
                        className="h-9 text-sm font-mono"
                        onClick={() => setTodayQuick('all')}
                      >
                        All today
                      </Button>
                      <Button
                        type="button"
                        variant={todayQuick === '60m' ? 'default' : 'outline'}
                        size="sm"
                        className="h-9 text-sm font-mono"
                        onClick={() => setTodayQuick('60m')}
                      >
                        Last 60m
                      </Button>
                      {todayQuick === '60m' && todayMinIso && (
                        <div className="text-sm font-mono text-slate-600">
                          Showing intents since {new Date(todayMinIso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </div>
                    <IntentLedger siteId={siteId} dateRange={effectiveTodayRange} minTimestampIso={todayMinIso} />
                  </div>
                  <LiveFeed siteId={siteId} adsOnly />
                </>
              )}
            </div>
          </TabsContent>

          {/* Custom tab: same as Today, user-selected date range */}
          <TabsContent value="custom">
            <div className="space-y-6">
              {effectiveCustomRange && (
                <>
                  <StatsCards siteId={siteId} dateRange={effectiveCustomRange} adsOnly />
                  <TimelineChart siteId={siteId} dateRange={effectiveCustomRange} />
                  <IntentLedger siteId={siteId} dateRange={effectiveCustomRange} />
                  <LiveFeed siteId={siteId} adsOnly />
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

