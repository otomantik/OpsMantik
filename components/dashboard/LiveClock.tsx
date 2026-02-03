'use client';

import { useState, useEffect } from 'react';

export function LiveClock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    // 1. Set time on first client render
    setTime(new Date().toLocaleTimeString('en-GB', { hour12: false }));

    // 2. Update every second
    const timer = setInterval(() => {
      setTime(new Date().toLocaleTimeString('en-GB', { hour12: false }));
    }, 1000);

    // 3. Cleanup: clear interval when component unmounts
    return () => clearInterval(timer);
  }, []);

  // During SSR or initial load: show skeleton to prevent layout shift
  if (!time) {
    return (
      <span className="inline-block w-[60px] h-[20px] bg-gray-100/10 animate-pulse rounded text-transparent">
        00:00:00
      </span>
    );
  }

  // tabular-nums: equal-width digits so the clock doesn't shift as digits change
  return (
    <span className="tabular-nums font-medium transition-opacity duration-500 animate-in fade-in">
      {time}
    </span>
  );
}
