'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';

/**
 * MonthBoundaryBanner - Shows banner when system month changes while dashboard is open
 * 
 * Detects month boundary transitions and prompts user to refresh to switch partitions.
 * No auto-resubscribe needed - user manually refreshes to load new month's data.
 */
export function MonthBoundaryBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [initialMonth, setInitialMonth] = useState<string | null>(null);

  const { t } = useTranslation();

  const getCurrentMonth = () => new Date().toISOString().slice(0, 7) + '-01';

  useEffect(() => {
    // Set initial month on mount
    setInitialMonth(getCurrentMonth());

    // Check for month change every 30 seconds
    const checkInterval = setInterval(() => {
      const currentMonth = getCurrentMonth();
      if (initialMonth && currentMonth !== initialMonth) {
        setShowBanner(true);
        clearInterval(checkInterval);
      }
    }, 30000); // Check every 30 seconds

    return () => {
      clearInterval(checkInterval);
    };
  }, [initialMonth]);

  const handleRefresh = () => {
    window.location.reload();
  };

  if (!showBanner) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-50/90 border-b border-amber-200 backdrop-blur-sm">
      <div className="max-w-[1920px] mx-auto px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></div>
            <p className="text-sm text-amber-900">
              {t('month.newMonthDetected')}
            </p>
          </div>
          <Button
            onClick={handleRefresh}
            variant="outline"
            size="sm"
            className="border-amber-300 text-amber-900 hover:bg-amber-100 text-sm"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            {t('button.refresh')}
          </Button>
        </div>
      </div>
    </div>
  );
}
