'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';

export function LiveClock() {
  const { locale } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    // 1. Set time on first client render
    setTime(new Date().toLocaleTimeString(locale, { hour12: false }));

    // 2. Update every second
    const timer = setInterval(() => {
      setTime(new Date().toLocaleTimeString(locale, { hour12: false }));
    }, 1000);

    // 3. Cleanup: clear interval when component unmounts
    return () => clearInterval(timer);
  }, [locale]);

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
    <span suppressHydrationWarning className="tabular-nums font-medium transition-opacity duration-500 animate-in fade-in">
      {time}
    </span>
  );
}
