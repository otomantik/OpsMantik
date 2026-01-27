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
import { CallAlertWrapper } from './call-alert-wrapper';
import { TrackedEventsPanel } from './tracked-events-panel';
import { ConversionTracker } from './conversion-tracker';
import { MonthBoundaryBanner } from './month-boundary-banner';
import { TimelineChart } from './timeline-chart';
import { IntentLedger } from './intent-ledger';
import { BreakdownWidget } from './breakdown-widget';
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
  });

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
              <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest leading-none">
                Son güncelleme: {formatTimestamp(health.data_latency, { hour: '2-digit', minute: '2-digit' })} TRT
              </p>
            </div>
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
        {/* Row 1: KPI Cards */}
        <section>
          <StatsCards siteId={siteId} dateRange={range} />
        </section>

        {/* Row 2: Timeline Chart */}
        <section>
          <TimelineChart siteId={siteId} dateRange={range} />
        </section>

        {/* Row 3: Intent Ledger */}
        <section>
          <IntentLedger siteId={siteId} dateRange={range} />
        </section>

        {/* Row 4: Main Activity Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Main Stream (Middle Focus) */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            {/* Call Monitor - High Intent Stream */}
            <div id="call-monitor">
              <CallAlertWrapper siteId={siteId} />
            </div>

            {/* Live Activity Feed - Engagement Volume */}
            <div id="live-feed">
              <LiveFeed siteId={siteId} />
            </div>
          </div>

          {/* Side Panels (Context & Configuration) */}
          <div className="lg:col-span-4 flex flex-col gap-6 sticky top-20">
            <BreakdownWidget siteId={siteId} dateRange={range} />
            <TrackedEventsPanel siteId={siteId} />
            <ConversionTracker siteId={siteId} />

            {/* Info Chip */}
            <div className="p-4 rounded-lg bg-slate-900/20 border border-slate-800/50">
              <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1 italic">
                Optimization Tip
              </p>
              <p className="text-[11px] font-mono text-slate-400">
                Real-time fingerprint matching is active. Calls are matched to web sessions via browser tokens.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
