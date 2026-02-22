'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';
import { getLocalizedLabel } from '@/lib/i18n/mapping';
import type { BreakdownItem } from '@/lib/hooks/use-dashboard-breakdown';

interface BreakdownBarRowProps {
  item: BreakdownItem;
  total: number;
  /** Optional: decode URL-encoded labels (e.g. locations) */
  decodeLabel?: boolean;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function BreakdownBarRow({ item, total, decodeLabel }: BreakdownBarRowProps) {
  const { formatNumber, t } = useTranslation();
  const rawLabel = decodeLabel ? safeDecode(item.name) : item.name;

  const label = getLocalizedLabel(rawLabel, t);
  const pctNum = total > 0 ? Math.min(100, Math.max(0, item.pct)) : 0;

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="text-sm text-slate-700 truncate" title={label}>
          {label}
        </span>
        <span className="text-sm tabular-nums shrink-0 font-medium text-slate-600" suppressHydrationWarning>
          {formatNumber(item.count)} ({item.pct}%)
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-500/80 transition-[width]"
          style={{ width: `${pctNum}%` }}
          role="progressbar"
          aria-valuenow={item.count}
          aria-valuemin={0}
          aria-valuemax={total}
        />
      </div>
    </div>
  );
}
