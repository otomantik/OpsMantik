'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useSiteTimezone } from '@/components/context/site-locale-context';

/**
 * Wall-clock for the dashboard header. Phase 5: renders in the active site's
 * timezone (via `useSiteTimezone`) instead of the browser's local zone so the
 * clock matches the timezone the conversion pipeline writes with.
 *
 * Falls back to UTC outside a `SiteLocaleProvider`, which is the neutral
 * default defined in `components/context/site-locale-context.tsx`.
 */
export function LiveClock() {
  const { locale } = useTranslation();
  const siteTimezone = useSiteTimezone();
  const [mounted, setMounted] = useState(false);
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const render = () =>
      new Date().toLocaleTimeString(locale, {
        hour12: false,
        timeZone: siteTimezone,
      });
    setTime(render());

    const timer = setInterval(() => {
      setTime(render());
    }, 1000);

    return () => clearInterval(timer);
  }, [locale, siteTimezone]);

  // During SSR or initial load: show skeleton to prevent layout shift and hydration errors
  if (!mounted || !time) {
    return (
      <span className="inline-block w-[60px] h-[20px] bg-gray-100/10 animate-pulse rounded text-transparent">
        --:--:--
      </span>
    );
  }

  // tabular-nums: equal-width digits so the clock doesn't shift as digits change
  return (
    <span
      suppressHydrationWarning
      className="tabular-nums font-medium transition-opacity duration-500 animate-in fade-in"
      title={`Site timezone: ${siteTimezone}`}
    >
      {time}
    </span>
  );
}
