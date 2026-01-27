/**
 * Iron Dome v2.1 - Phase 3: Command Center Layout
 * 
 * Main dashboard layout with URL-state managed date range.
 * 
 * Architecture:
 * - URL stores UTC dates (ISO strings)
 * - UI displays TRT (Europe/Istanbul)
 * - Max 6 months range enforced
 * - Normalized at API boundary
 */

'use client';

import { useDashboardDateRange } from '@/lib/hooks/use-dashboard-date-range';
import { DateRangePicker } from './date-range-picker';
import { HealthIndicator, DashboardHealth } from './health-indicator';
import { StatsCards } from './stats-cards';
import { LiveFeed } from './live-feed';
import { MonthBoundaryBanner } from './month-boundary-banner';
import { TimelineChart } from './timeline-chart';
import { IntentLedger } from './intent-ledger';
import { LiveInbox } from './live-inbox';
import { RealtimePulse } from './realtime-pulse';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import { formatTimestamp } from '@/lib/utils';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';

export interface DashboardStats {
  site_id: string;
  range_days: number;
  total_calls: number;
  total_events: number;
  total_sessions: number;
  unique_visitors: number;
  confirmed_calls: number;
  conversion_rate: number;
  last_event_at: string | null;
  last_call_at: string | null;
}

export interface TimelinePoint {
  date: string; // ISO date
  visitors: number;
  events: number;
  calls: number;
  conversions: number;
}

export interface IntentRow {
  id: string;
  phone_number: string;
  matched_session_id: string | null;
  lead_score: number;
  status: string | null;
  created_at: string;
  matched_at: string | null;
}

export interface Breakdown {
  sources: Array<{ source: string; count: number }>;
  devices: Array<{ device: string; count: number }>;
  cities: Array<{ city: string; count: number }>;
}

interface DashboardLayoutProps {
  siteId: string;
  siteName?: string;
  siteDomain?: string;
  initialHealth?: DashboardHealth;
  onSignOut?: () => void;
}

export function DashboardLayout({
  siteId,
  siteName,
  siteDomain,
  initialHealth,
  onSignOut,
}: DashboardLayoutProps) {
  const { range, presets, updateRange, applyPreset } = useDashboardDateRange(siteId);

  // Realtime dashboard connection
  const realtime = useRealtimeDashboard(siteId, {
    onDataFreshness: (lastEventAt) => {
      // Update health data latency when new events arrive
      // This is handled optimistically - actual health check is separate
    },
  }, { adsOnly: true });

  // Default health if not provided
  const health: DashboardHealth = initialHealth || {
    data_latency: new Date().toISOString(),
    completeness: 1.0,
    last_sync: new Date().toISOString(),
    status: 'healthy',
  };

  return (
    <div className="min-h-screen bg-[#020617] relative">
      <MonthBoundaryBanner />

      {/* Top Bar - Command Center Header */}
      <header className="sticky top-0 z-50 border-b border-slate-800/60 bg-slate-900/40 backdrop-blur-md">
        <div className="max-w-[1920px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-slate-500 hover:text-slate-300 transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div className="h-6 w-[1px] bg-slate-800 mx-1"></div>
            <div>
              <h1 className="text-sm font-mono font-bold text-slate-100 uppercase tracking-tighter">
                {siteName || siteDomain || 'Site Analytics'}
              </h1>
              {/* FIX 1: Suppress hydration warning for timestamp */}
              <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest leading-none" suppressHydrationWarning>
                Son güncelleme: {formatTimestamp(health.data_latency, { hour: '2-digit', minute: '2-digit' })} TRT
              </p>
            </div>
            <span className="ml-2 inline-flex items-center px-2.5 py-1 rounded border border-amber-500/30 bg-amber-500/10 text-[10px] font-mono text-amber-300 uppercase tracking-[0.22em]">
              ADS-ONLY MODE
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* DateRangePicker */}
            <DateRangePicker
              value={range}
              onSelect={updateRange}
              onPresetSelect={applyPreset}
              presets={presets}
              timezone="Europe/Istanbul"
              maxRange={180} // 6 months max
            />

            {/* Health Badge */}
            <HealthIndicator health={health} />

            {/* Realtime Pulse */}
            <RealtimePulse
              isConnected={realtime.isConnected}
              lastEventAt={realtime.lastEventAt}
              eventCount={realtime.eventCount}
              error={realtime.error}
            />

            {process.env.NODE_ENV === 'development' && (
              <Link href="/test-page">
                <Button variant="ghost" size="sm" className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 uppercase tracking-wider h-8">
                  🧪 Simulator
                </Button>
              </Link>
            )}
            {onSignOut && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onSignOut}
                className="text-[10px] font-mono text-slate-400 hover:text-slate-200 uppercase tracking-wider h-8 border border-slate-800/50"
              >
                Sign Out
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="max-w-[1920px] mx-auto p-6 space-y-6">
        {/* Ads Command Center: KPI Row (Ads-only) */}
        <section>
          <StatsCards siteId={siteId} dateRange={range} adsOnly />
        </section>

        {/* Phase A: Live Inbox (fast, last 60m) */}
        <section>
          <LiveInbox siteId={siteId} />
        </section>

        {/* Optional: Timeline (Ads-only) */}
        <section>
          <TimelineChart siteId={siteId} dateRange={range} />
        </section>

        {/* Intent Ledger (Ads-only) */}
        <section>
          <IntentLedger siteId={siteId} dateRange={range} />
        </section>

        {/* Live Stream (Ads-only) */}
        <section id="live-stream">
          <LiveFeed siteId={siteId} adsOnly />
        </section>
      </main>
    </div>
  );
}
