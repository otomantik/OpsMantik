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
import { strings } from '@/lib/i18n/en';

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
  const router = useRouter();
  const searchParams = useSearchParams();

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
    { label: strings.today, value: 'today' },
    { label: strings.yesterday, value: 'yesterday' },
    { label: strings.last7Days, value: '7d' },
    { label: strings.last30Days, value: '30d' },
    { label: strings.thisMonth, value: 'month' },
  ], []);

  // Apply preset
  const applyPreset = useCallback((presetValue: string) => {
    const now = new Date();
    let from: Date;
    let to: Date = new Date(now);
    to.setHours(23, 59, 59, 999);

    switch (presetValue) {
      case 'today':
        from = new Date(now);
        from.setHours(0, 0, 0, 0);
        break;
      case 'yesterday':
        from = new Date(now);
        from.setDate(from.getDate() - 1);
        from.setHours(0, 0, 0, 0);
        to = new Date(now);
        to.setDate(to.getDate() - 1);
        to.setHours(23, 59, 59, 999);
        break;
      case '7d':
        from = new Date(now);
        from.setDate(from.getDate() - 7);
        from.setHours(0, 0, 0, 0);
        break;
      case '30d':
        from = new Date(now);
        from.setDate(from.getDate() - 30);
        from.setHours(0, 0, 0, 0);
        break;
      case 'month':
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        from.setHours(0, 0, 0, 0);
        break;
      default:
        return;
    }

    updateRange({ from, to });
  }, []);

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
