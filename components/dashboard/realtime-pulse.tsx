/**
 * Realtime Pulse Indicator
 * 
 * Shows connection status and last event timestamp
 */

'use client';

import { Wifi, WifiOff, Activity } from 'lucide-react';
import { formatTimestamp } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface RealtimePulseProps {
  isConnected: boolean;
  lastEventAt: Date | null;
  eventCount: number;
  error?: string | null;
}

export function RealtimePulse({ isConnected, lastEventAt, eventCount, error }: RealtimePulseProps) {
  const { t, toLocaleUpperCase } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      {isConnected ? (
        <>
          <div className="relative">
            <Wifi className="h-3.5 w-3.5 text-emerald-600" />
            <div className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-emerald-500 rounded-full animate-pulse" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm text-emerald-600 uppercase tracking-wider">
              {toLocaleUpperCase(t('pulse.live'))}
            </span>
            {lastEventAt && (
              <span className="text-sm text-muted-foreground tabular-nums" suppressHydrationWarning>
                {formatTimestamp(lastEventAt.toISOString(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="flex flex-col">
            <span className="text-sm text-muted-foreground uppercase tracking-wider">
              {toLocaleUpperCase(t('pulse.offline'))}
            </span>
            {error && (
              <span className="text-sm text-rose-600 truncate max-w-[160px]">
                {error}
              </span>
            )}
          </div>
        </>
      )}
      {eventCount > 0 && (
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted border border-border">
          <Activity className="h-2.5 w-2.5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground tabular-nums">{eventCount}</span>
        </div>
      )}
    </div>
  );
}
