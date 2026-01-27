/**
 * Iron Dome v2.1 - Phase 5: Timeline Chart with Bounded Refresh Strategy
 * 
 * Refresh Policy:
 * 1. Initial Load: On mount + date range change
 * 2. Realtime Updates: Optimistic for KPI, NOT for chart
 * 3. Interval Refresh: Every 5 minutes for current day, 30min for historical
 * 4. Manual Refresh: User-triggered
 * 
 * Rationale: Charts are expensive to render. Real-time updates cause:
 * - CPU spikes
 * - Layout thrashing
 * - Poor mobile performance
 * 
 * Instead: Show "Data updating..." badge when new data available
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, TrendingUp } from 'lucide-react';
import { useTimelineData, TimelinePoint } from '@/lib/hooks/use-timeline-data';
import { DateRange } from '@/lib/hooks/use-dashboard-date-range';
import { formatTimestamp } from '@/lib/utils';

interface TimelineChartProps {
  siteId: string;
  dateRange: DateRange;
  refreshInterval?: '1m' | '5m' | '30m';
}

export function TimelineChart({
  siteId,
  dateRange,
  refreshInterval = '5m',
}: TimelineChartProps) {
  const { data, loading, error, refetch } = useTimelineData(siteId, dateRange);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [hasNewData, setHasNewData] = useState(false);

  // Determine refresh interval based on date range
  const effectiveInterval = useMemo(() => {
    const rangeDays = Math.ceil(
      (dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24)
    );
    
    // Current day: 5m, Historical: 30m
    const isCurrentDay = rangeDays <= 1 && 
      dateRange.to.toDateString() === new Date().toDateString();
    
    return isCurrentDay ? '5m' : '30m';
  }, [dateRange]);

  const handleRefresh = useCallback(async (silent = false) => {
    if (!silent) {
      setIsRefreshing(true);
    }
    
    // Log refresh in development
    if (process.env.NODE_ENV === 'development') {
      console.log('[TimelineChart] Refreshing chart', { silent, timestamp: new Date().toISOString() });
    }
    
    try {
      await refetch();
      setLastUpdated(new Date());
      setHasNewData(false);
    } catch (err) {
      console.error('[TimelineChart] Refresh error:', err);
    } finally {
      if (!silent) {
        setIsRefreshing(false);
      }
    }
  }, [refetch]);

  // Auto-refresh based on interval
  useEffect(() => {
    const intervalMs = {
      '1m': 60000,
      '5m': 300000,
      '30m': 1800000,
    }[effectiveInterval];

    if (process.env.NODE_ENV === 'development') {
      console.log('[TimelineChart] Auto-refresh interval set:', effectiveInterval, `(${intervalMs}ms)`);
    }

    const interval = setInterval(() => {
      // Only refresh if tab is visible
      if (document.visibilityState === 'visible') {
        handleRefresh(true); // Silent refresh
      }
    }, intervalMs);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveInterval]);

  // Simple SVG-based chart (no external dependencies)
  // TODO: Install recharts for better chart visualization
  const renderChart = () => {
    // FIX 3: Defensive rendering - ensure data is array
    if (!Array.isArray(data) || data.length === 0) {
      return (
        <div className="h-[400px] flex items-center justify-center">
          <div className="text-center">
            <TrendingUp className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400 font-mono text-sm uppercase tracking-widest">
              Veri yok
            </p>
            <p className="text-slate-600 font-mono text-[10px] mt-2 italic">
              Seçili tarih aralığında veri bulunamadı
            </p>
          </div>
        </div>
      );
    }

    // FIX 2: Ensure all values are numbers (defensive parsing)
    const safeData = data.map(d => ({
      ...d,
      visitors: typeof d.visitors === 'number' ? d.visitors : 0,
      events: typeof d.events === 'number' ? d.events : 0,
      calls: typeof d.calls === 'number' ? d.calls : 0,
    }));

    // Calculate max values for scaling
    const maxVisitors = Math.max(...safeData.map(d => d.visitors), 1);
    const maxEvents = Math.max(...safeData.map(d => d.events), 1);
    const maxCalls = Math.max(...safeData.map(d => d.calls), 1);
    const maxValue = Math.max(maxVisitors, maxEvents, maxCalls, 1);

    const chartHeight = 400;
    const chartWidth = 800;
    const padding = { top: 20, right: 40, bottom: 40, left: 60 };

    return (
      <div className="h-[400px] overflow-x-auto">
        <svg
          width={Math.max(chartWidth, data.length * 40)}
          height={chartHeight}
          className="w-full"
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padding.top + (chartHeight - padding.top - padding.bottom) * (1 - ratio);
            return (
              <line
                key={ratio}
                x1={padding.left}
                y1={y}
                x2={chartWidth - padding.right}
                y2={y}
                stroke="#1e293b"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
            );
          })}

          {/* Data lines */}
          {safeData.map((point, index) => {
            const x = padding.left + (index / (safeData.length - 1 || 1)) * (chartWidth - padding.left - padding.right);
            const visitorsY = padding.top + (chartHeight - padding.top - padding.bottom) * (1 - point.visitors / maxValue);
            const eventsY = padding.top + (chartHeight - padding.top - padding.bottom) * (1 - point.events / maxValue);
            const callsY = padding.top + (chartHeight - padding.top - padding.bottom) * (1 - point.calls / maxValue);

            return (
              <g key={point.date}>
                {/* Visitors (blue) */}
                <circle
                  cx={x}
                  cy={visitorsY}
                  r={3}
                  fill="#3b82f6"
                  className="hover:r-5 transition-all"
                />
                {/* Events (green) */}
                <circle
                  cx={x}
                  cy={eventsY}
                  r={3}
                  fill="#10b981"
                  className="hover:r-5 transition-all"
                />
                {/* Calls (purple) */}
                <circle
                  cx={x}
                  cy={callsY}
                  r={3}
                  fill="#8b5cf6"
                  className="hover:r-5 transition-all"
                />
              </g>
            );
          })}

          {/* Connect points with lines */}
          {safeData.length > 1 && (
            <>
              {/* Visitors line */}
              <polyline
                points={safeData.map((point, index) => {
                  const x = padding.left + (index / (safeData.length - 1)) * (chartWidth - padding.left - padding.right);
                  const y = padding.top + (chartHeight - padding.top - padding.bottom) * (1 - point.visitors / maxValue);
                  return `${x},${y}`;
                }).join(' ')}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={2}
                opacity={0.6}
              />
              {/* Events line */}
              <polyline
                points={safeData.map((point, index) => {
                  const x = padding.left + (index / (safeData.length - 1)) * (chartWidth - padding.left - padding.right);
                  const y = padding.top + (chartHeight - padding.top - padding.bottom) * (1 - point.events / maxValue);
                  return `${x},${y}`;
                }).join(' ')}
                fill="none"
                stroke="#10b981"
                strokeWidth={2}
                opacity={0.6}
              />
              {/* Calls line */}
              <polyline
                points={safeData.map((point, index) => {
                  const x = padding.left + (index / (safeData.length - 1)) * (chartWidth - padding.left - padding.right);
                  const y = padding.top + (chartHeight - padding.top - padding.bottom) * (1 - point.calls / maxValue);
                  return `${x},${y}`;
                }).join(' ')}
                fill="none"
                stroke="#8b5cf6"
                strokeWidth={2}
                opacity={0.6}
              />
            </>
          )}

          {/* X-axis labels */}
          {safeData.filter((_, i) => i % Math.ceil(safeData.length / 10) === 0 || i === safeData.length - 1).map((point, index) => {
            const x = padding.left + (safeData.indexOf(point) / (safeData.length - 1 || 1)) * (chartWidth - padding.left - padding.right);
            return (
              <text
                key={point.date}
                x={x}
                y={chartHeight - padding.bottom + 20}
                textAnchor="middle"
                className="text-[10px] font-mono fill-slate-400"
              >
                {point.label}
              </text>
            );
          })}
        </svg>
      </div>
    );
  };

  return (
    <Card className="glass border-slate-800/50">
      <CardHeader className="pb-3 border-b border-slate-800/20">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono text-slate-200 uppercase tracking-tighter">
            Zaman Çizelgesi
          </CardTitle>
          
          <div className="flex items-center gap-4">
            {/* Legend */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="text-[10px] font-mono text-slate-400 uppercase">Trafik</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-[10px] font-mono text-slate-400 uppercase">Etkinlik</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-purple-500" />
                <span className="text-[10px] font-mono text-slate-400 uppercase">Çağrılar</span>
              </div>
            </div>

            {/* Refresh Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleRefresh(false)}
              disabled={isRefreshing || loading}
              className="h-7 w-7 p-0 bg-slate-800/30 hover:bg-slate-700/50 border border-slate-700/50"
            >
              <RefreshCw className={`h-3 w-3 text-slate-400 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        {error ? (
          <div className="h-[400px] flex items-center justify-center">
            <div className="text-center">
              <p className="text-rose-400 font-mono text-sm mb-2">Hata: {error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRefresh(false)}
                className="bg-slate-800/60 border-slate-700/50 text-slate-200"
              >
                Tekrar Dene
              </Button>
            </div>
          </div>
        ) : loading ? (
          <div className="h-[400px] flex items-center justify-center">
            <div className="text-center">
              <RefreshCw className="h-8 w-8 text-slate-600 animate-spin mx-auto mb-4" />
              <p className="text-slate-400 font-mono text-sm uppercase tracking-widest">
                Yükleniyor...
              </p>
            </div>
          </div>
        ) : (
          <>
            {renderChart()}
            
            {/* Last Updated */}
            {/* FIX 1: Suppress hydration warning for timestamp */}
            <div className="mt-4 flex items-center justify-between">
              <div className="text-[10px] font-mono text-slate-500" suppressHydrationWarning>
                Son güncelleme: {formatTimestamp(lastUpdated.toISOString(), { 
                  hour: '2-digit', 
                  minute: '2-digit',
                  second: '2-digit'
                })} TRT
                {isRefreshing && ' (güncelleniyor...)'}
                {hasNewData && (
                  <span className="ml-2 text-emerald-400">• Yeni veri mevcut</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-600 italic">
                Otomatik yenileme: {effectiveInterval === '5m' ? '5 dakika' : '30 dakika'}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
