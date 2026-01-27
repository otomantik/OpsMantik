'use client';

import { CheckCircle2, Clock, XCircle, AlertTriangle } from 'lucide-react';
import { IntentStatus } from '@/lib/hooks/use-intents';
import { formatTimestamp } from '@/lib/utils';

interface IntentStatusBadgeProps {
  status: IntentStatus;
  sealedAt: string | null;
}

export function IntentStatusBadge({ status, sealedAt }: IntentStatusBadgeProps) {
  if (status === 'confirmed' || status === 'qualified' || status === 'real') {
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-mono text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          Kapanan
        </span>
        {sealedAt && (
          <span className="text-[9px] font-mono text-slate-500">
            {formatTimestamp(sealedAt, { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    );
  }

  if (status === 'junk') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-600/30 bg-slate-700/20 text-[10px] font-mono text-slate-500">
        <XCircle className="h-3 w-3" />
        Çöp
      </span>
    );
  }

  if (status === 'suspicious') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-rose-500/30 bg-rose-500/10 text-[10px] font-mono text-rose-400">
        <AlertTriangle className="h-3 w-3" />
        Şüpheli
      </span>
    );
  }

  // pending (intent or null)
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-[10px] font-mono text-amber-400">
      <Clock className="h-3 w-3" />
      Bekleyen
    </span>
  );
}
