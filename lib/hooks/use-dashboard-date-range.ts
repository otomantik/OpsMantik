/**
 * Iron Dome v2.1 - Phase 3: URL-State Management
 * 
 * Hook for managing dashboard date range via URL search params.
 * 
 * Contract:
 * - UTC stored in URL (ISO strings)
 * - TRT displayed in UI
 * - Max 6 months range enforced
 * - Normalized at API boundary
 */

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useCallback } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useSiteTimezone } from '@/components/context/site-locale-context';
import { dateKeyToUtcRange, getTodayDateKey, resolveDashboardDayTimezone } from '@/lib/time/today-range';

export interface DateRange {
  from: Date;
  to: Date;
}

export interface DateRangePreset {
  label: string;
  value: string;
}

/**
 * Hook for managing dashboard date range from URL params.
 * 
 * @param siteId - Site ID for URL construction
 * @returns Date range, presets, and update function
 */
export function useDashboardDateRange(siteId: string) {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const siteTimezone = resolveDashboardDayTimezone(useSiteTimezone());

  // Parse URL params (expects ISO strings in UTC)
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');

  const dateRange = useMemo<DateRange>(() => {
    // Phase B1 guarantees URL always contains from/to after first open (server redirect).
    // Keep a defensive fallback (never writes URL here) to avoid runtime crashes.
    const from = fromParam ? new Date(fromParam) : new Date(0);
    const to = toParam ? new Date(toParam) : new Date(0);

    // Validate dates
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return { from: new Date(0), to: new Date(0) };
    }

    // Enforce max 6 months range
    const maxRangeDays = 180;
    const rangeDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
    
    if (rangeDays > maxRangeDays) {
      // Clamp to max range
      const clampedFrom = new Date(to);
      clampedFrom.setDate(clampedFrom.getDate() - maxRangeDays);
      return { from: clampedFrom, to };
    }

    // Ensure from <= to
    if (from > to) {
      return { from: to, to: from };
    }

    return { from, to };
  }, [fromParam, toParam]);

  const presets: DateRangePreset[] = useMemo(() => [
    { label: t('date.today'), value: 'today' },
    { label: t('date.yesterday'), value: 'yesterday' },
    { label: t('date.last7Days'), value: '7d' },
    { label: t('date.last30Days'), value: '30d' },
    { label: t('date.thisMonth'), value: 'month' },
  ], [t]);

  // Apply preset
  const applyPreset = useCallback((presetValue: string) => {
    const todayKey = getTodayDateKey(siteTimezone);
    const todayRange = dateKeyToUtcRange(todayKey, siteTimezone);
    const shiftDateKey = (key: string, days: number): string => {
      const [y, m, d] = key.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
      dt.setUTCDate(dt.getUTCDate() + days);
      const yy = dt.getUTCFullYear();
      const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(dt.getUTCDate()).padStart(2, '0');
      return `${yy}-${mm}-${dd}`;
    };
    let fromIso: string;
    let toIso: string;

    switch (presetValue) {
      case 'today': {
        fromIso = todayRange.fromIso;
        toIso = todayRange.toIso;
        break;
      }
      case 'yesterday': {
        const yKey = shiftDateKey(todayKey, -1);
        const yRange = dateKeyToUtcRange(yKey, siteTimezone);
        fromIso = yRange.fromIso;
        toIso = yRange.toIso;
        break;
      }
      case '7d': {
        const fromKey = shiftDateKey(todayKey, -7);
        fromIso = dateKeyToUtcRange(fromKey, siteTimezone).fromIso;
        toIso = todayRange.toIso;
        break;
      }
      case '30d': {
        const fromKey = shiftDateKey(todayKey, -30);
        fromIso = dateKeyToUtcRange(fromKey, siteTimezone).fromIso;
        toIso = todayRange.toIso;
        break;
      }
      case 'month': {
        const [y, m] = todayKey.split('-');
        const monthStartKey = `${y}-${m}-01`;
        fromIso = dateKeyToUtcRange(monthStartKey, siteTimezone).fromIso;
        toIso = todayRange.toIso;
        break;
      }
      default:
        return;
    }

    updateRange({ from: new Date(fromIso), to: new Date(toIso) });
  }, [siteTimezone, updateRange]);

  // Update range in URL
  const updateRange = useCallback((range: DateRange) => {
    const params = new URLSearchParams(searchParams.toString());
    
    // Store UTC ISO strings in URL
    params.set('from', range.from.toISOString());
    params.set('to', range.to.toISOString());
    
    router.push(`/dashboard/site/${siteId}?${params.toString()}`);
  }, [siteId, router, searchParams]);

  return {
    range: dateRange,
    presets,
    updateRange,
    applyPreset,
  };
}
