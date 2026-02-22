'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';
import { Icons, PulseIndicator } from '@/components/icons';
import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface DashboardHeaderV2Props {
  siteId: string;
  siteName?: string;
  siteDomain?: string;
}

export function DashboardHeaderV2({ siteId, siteName, siteDomain }: DashboardHeaderV2Props) {
  const { isConnected, lastEventAt } = useRealtimeDashboard(siteId, undefined, { adsOnly: true });
  const { t } = useTranslation();
  // Keep a ticking "now" value so render stays pure (no Date.now in render).
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, []);

  const formatLastSeen = (date: Date | null) => {
    if (!date) return 'Never';
    const seconds = Math.floor((nowMs - date.getTime()) / 1000);
    if (seconds < 10) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <header className="border-b border-border bg-background sticky top-0 z-10">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Left: Back + Site Info */}
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/dashboard">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Icons.chevronLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">
                {siteName || siteDomain || 'Site Dashboard'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('dashboard.adsCommandCenter')}
              </p>
            </div>
            <Badge className="bg-amber-100 text-amber-800 border-amber-200 shrink-0">
              {t('dashboard.adsOnly')}
            </Badge>
          </div>

          {/* Right: Realtime Pulse */}
          <div className="flex items-center gap-2">
            {isConnected ? (
              <>
                <div className="flex items-center gap-2">
                  <PulseIndicator status="online" />
                  <span className="text-sm font-medium text-green-700">{t('status.live')}</span>
                </div>
                {lastEventAt && (
                  <span className="text-sm text-muted-foreground">
                    • {formatLastSeen(lastEventAt)}
                  </span>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2">
                <PulseIndicator status="offline" />
                <span className="text-sm font-medium text-red-700">{t('status.offline')}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
