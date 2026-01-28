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

import { useMemo } from 'react';
import { HealthIndicator, DashboardHealth } from './health-indicator';
import { MonthBoundaryBanner } from './month-boundary-banner';
import { RealtimePulse } from './realtime-pulse';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import { formatTimestamp } from '@/lib/utils';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTrigger, SheetClose } from '@/components/ui/sheet';
import { ChevronLeft, Menu, X } from 'lucide-react';
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

  const health: DashboardHealth = useMemo(() => {
    if (initialHealth) return initialHealth;
    const last = realtime.lastEventAt ? realtime.lastEventAt.toISOString() : '';
    const status: DashboardHealth['status'] = realtime.isConnected
      ? 'healthy'
      : realtime.error
        ? 'critical'
        : 'degraded';
    return {
      data_latency: last,
      completeness: 1.0,
      last_sync: last || null,
      status,
    };
  }, [initialHealth, realtime.error, realtime.isConnected, realtime.lastEventAt]);

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-x-hidden" data-dashboard="light">
      <MonthBoundaryBanner />

      {/* Top Bar - Command Center Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-[1920px] mx-auto px-4 sm:px-6 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Row 1 (mobile): back + title + badge */}
            <div className="flex items-start gap-2 min-w-0">
              {/* Mobile sidebar */}
              <div className="sm:hidden mt-0.5">
                <Sheet>
                  <SheetTrigger>
                    <Button variant="outline" size="icon" className="h-9 w-9">
                      <Menu className="h-5 w-5" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="text-base font-semibold">Dashboard</div>
                        <SheetClose>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <X className="h-4 w-4" />
                          </Button>
                        </SheetClose>
                      </div>
                      <div className="space-y-2">
                        <Link href="/dashboard" className="block text-sm text-muted-foreground hover:text-foreground">
                          ← Back to Dashboard
                        </Link>
                        <div className="text-sm text-muted-foreground">
                          {siteName || siteDomain || 'Site Analytics'}
                        </div>
                      </div>
                      <div className="border-t border-border pt-4 space-y-2">
                        {onSignOut && (
                          <Button type="button" variant="outline" size="sm" onClick={onSignOut} className="w-full h-9">
                            Sign Out
                          </Button>
                        )}
                        {process.env.NODE_ENV === 'development' && (
                          <Link href="/test-page">
                            <Button variant="outline" size="sm" className="w-full h-9">Simulator</Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>

              {/* Breadcrumb / back */}
              <Link href="/dashboard" className="mt-1 text-muted-foreground hover:text-foreground transition-colors hidden sm:inline-flex">
                <ChevronLeft className="w-5 h-5" />
              </Link>

              <div className="min-w-0 flex-1">
                <h1 className="text-base font-semibold truncate">
                  {siteName || siteDomain || 'Site Analytics'}
                </h1>
                <p className="text-sm text-muted-foreground truncate" suppressHydrationWarning>
                  Son güncelleme: {formatTimestamp(health.data_latency, { hour: '2-digit', minute: '2-digit' })} TRT
                </p>
              </div>

              <Badge className="shrink-0" variant="outline">
                ADS-ONLY
              </Badge>
            </div>

            {/* Row 2 (mobile): health + realtime + actions */}
            <div className="flex items-center gap-2 flex-wrap justify-start sm:justify-end">
              <HealthIndicator health={health} />
              <RealtimePulse
                isConnected={realtime.isConnected}
                lastEventAt={realtime.lastEventAt}
                eventCount={realtime.eventCount}
                error={realtime.error}
              />

              {/* Desktop actions (mobile actions live in Sheet) */}
              <div className="hidden sm:flex items-center gap-2">
                {process.env.NODE_ENV === 'development' && (
                  <Link href="/test-page">
                    <Button variant="outline" size="sm" className="h-9">
                      Simulator
                    </Button>
                  </Link>
                )}
                {onSignOut && (
                  <Button type="button" variant="outline" size="sm" onClick={onSignOut} className="h-9">
                    Sign Out
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="max-w-[1920px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        <DashboardTabs siteId={siteId} />
      </main>
    </div>
  );
}
