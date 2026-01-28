/**
 * Health Indicator Component
 * 
 * Displays dashboard health status (data latency, completeness).
 */

'use client';

import { Activity, AlertCircle, CheckCircle2 } from 'lucide-react';
import { formatTimestamp } from '@/lib/utils';

export interface DashboardHealth {
  data_latency: string; // ISO timestamp
  completeness: number; // 0-1
  last_sync: string | null; // ISO timestamp
  status: 'healthy' | 'degraded' | 'critical';
}

interface HealthIndicatorProps {
  health: DashboardHealth;
}

export function HealthIndicator({ health }: HealthIndicatorProps) {
  const getStatusColor = () => {
    switch (health.status) {
      case 'healthy':
        return 'text-emerald-600';
      case 'degraded':
        return 'text-amber-600';
      case 'critical':
        return 'text-rose-600';
      default:
        return 'text-slate-600';
    }
  };

  const getStatusIcon = () => {
    switch (health.status) {
      case 'healthy':
        return <CheckCircle2 className="w-4 h-4" />;
      case 'degraded':
        return <Activity className="w-4 h-4" />;
      case 'critical':
        return <AlertCircle className="w-4 h-4" />;
      default:
        return <Activity className="w-4 h-4" />;
    }
  };

  const formatLatency = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Şimdi';
    if (diffMins < 60) return `${diffMins} dk önce`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} sa önce`;
    return formatTimestamp(timestamp, { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg">
      {getStatusIcon()}
      <div className="flex flex-col">
        <span className={`text-sm uppercase tracking-wider ${getStatusColor()}`}>
          {health.status === 'healthy' ? 'Sağlıklı' : health.status === 'degraded' ? 'Düşük' : 'Kritik'}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatLatency(health.data_latency)} TRT
        </span>
      </div>
    </div>
  );
}
