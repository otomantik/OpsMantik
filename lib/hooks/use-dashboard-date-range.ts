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

  // Default: Last 7 days (in TRT, but stored as UTC)
  const defaultRange = useMemo(() => {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    // Start of day (00:00:00) in TRT
    const from = new Date(sevenDaysAgo);
    from.setHours(0, 0, 0, 0);
    
    // End of day (23:59:59) in TRT
    const to = new Date(now);
    to.setHours(23, 59, 59, 999);
    
    return { from, to };
  }, []);

  // Parse URL params (expects ISO strings in UTC)
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');

  const dateRange = useMemo<DateRange>(() => {
    const from = fromParam ? new Date(fromParam) : defaultRange.from;
    const to = toParam ? new Date(toParam) : defaultRange.to;

    // Validate dates
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return defaultRange;
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
  }, [fromParam, toParam, defaultRange]);

  // Presets (Turkish labels)
  const presets: DateRangePreset[] = useMemo(() => [
    { label: 'Bugün', value: 'today' },
    { label: 'Dün', value: 'yesterday' },
    { label: 'Son 7 Gün', value: '7d' },
    { label: 'Son 30 Gün', value: '30d' },
    { label: 'Bu Ay', value: 'month' },
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
