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

import { HealthIndicator, DashboardHealth } from './health-indicator';
import { MonthBoundaryBanner } from './month-boundary-banner';
import { RealtimePulse } from './realtime-pulse';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import { formatTimestamp } from '@/lib/utils';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { DashboardTabs } from '@/components/dashboard/dashboard-tabs';

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
    <div className="min-h-screen bg-white text-slate-900 relative" data-dashboard="light">
      <MonthBoundaryBanner />

      {/* Top Bar - Command Center Header */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="max-w-[1920px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-slate-700 hover:text-slate-900 transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div className="h-6 w-[1px] bg-slate-200 mx-1"></div>
            <div>
              <h1 className="text-base font-mono font-bold text-slate-900 uppercase tracking-tighter">
                {siteName || siteDomain || 'Site Analytics'}
              </h1>
              {/* FIX 1: Suppress hydration warning for timestamp */}
              <p className="text-sm font-mono text-slate-600 uppercase tracking-wider leading-none" suppressHydrationWarning>
                Son güncelleme: {formatTimestamp(health.data_latency, { hour: '2-digit', minute: '2-digit' })} TRT
              </p>
            </div>
            <span className="ml-2 inline-flex items-center px-3 py-1 rounded border border-amber-400 bg-amber-50 text-sm font-mono text-amber-800 uppercase tracking-wider">
              ADS-ONLY MODE
            </span>
          </div>

          <div className="flex items-center gap-3">
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
                <Button variant="ghost" size="sm" className="text-sm font-mono text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 uppercase tracking-wider h-9">
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
                className="text-sm font-mono text-slate-700 hover:text-slate-900 uppercase tracking-wider h-9 border border-slate-200"
              >
                Sign Out
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="max-w-[1920px] mx-auto p-6 space-y-6">
        <DashboardTabs siteId={siteId} />
      </main>
    </div>
  );
}
