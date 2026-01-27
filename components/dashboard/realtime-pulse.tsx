/**
 * Realtime Pulse Indicator
 * 
 * Shows connection status and last event timestamp
 */

'use client';

import { Wifi, WifiOff, Activity } from 'lucide-react';
import { formatTimestamp } from '@/lib/utils';

interface RealtimePulseProps {
  isConnected: boolean;
  lastEventAt: Date | null;
  eventCount: number;
  error?: string | null;
}

export function RealtimePulse({ isConnected, lastEventAt, eventCount, error }: RealtimePulseProps) {
  return (
    <div className="flex items-center gap-2">
      {isConnected ? (
        <>
          <div className="relative">
            <Wifi className="h-3.5 w-3.5 text-emerald-400" />
            <div className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-emerald-400 rounded-full animate-pulse" />
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] font-mono text-emerald-400 uppercase tracking-wider">
              Live
            </span>
            {lastEventAt && (
              <span className="text-[8px] font-mono text-slate-500">
                {formatTimestamp(lastEventAt.toISOString(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <WifiOff className="h-3.5 w-3.5 text-slate-600" />
          <div className="flex flex-col">
            <span className="text-[9px] font-mono text-slate-600 uppercase tracking-wider">
              Offline
            </span>
            {error && (
              <span className="text-[8px] font-mono text-rose-500 truncate max-w-[100px]">
                {error}
              </span>
            )}
          </div>
        </>
      )}
      {eventCount > 0 && (
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800/30 border border-slate-700/50">
          <Activity className="h-2.5 w-2.5 text-slate-400" />
          <span className="text-[8px] font-mono text-slate-400">{eventCount}</span>
        </div>
      )}
    </div>
  );
}
