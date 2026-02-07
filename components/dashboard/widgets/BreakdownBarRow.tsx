'use client';

import type { BreakdownItem } from '@/lib/hooks/use-dashboard-breakdown';

interface BreakdownBarRowProps {
  item: BreakdownItem;
  total: number;
  /** Optional: decode URL-encoded labels (e.g. locations) */
  decodeLabel?: boolean;
}

function fixMojibake(s: string): string {
  // Fix common mojibake like "Ä°zmir" when UTF-8 bytes were decoded as Latin1.
  // Heuristic: presence of these characters often indicates the problem.
  if (!/[ÃÄÅ]/.test(s)) return s;
  try {
    const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return decoded || s;
  } catch {
    return s;
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function BreakdownBarRow({ item, total, decodeLabel }: BreakdownBarRowProps) {
  const rawLabel = decodeLabel ? safeDecode(item.name) : item.name;
  const label = fixMojibake(rawLabel);
  const pctNum = total > 0 ? Math.min(100, Math.max(0, item.pct)) : 0;

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="text-sm text-slate-700 truncate" title={label}>
          {label}
        </span>
        <span className="text-sm tabular-nums shrink-0 font-medium text-slate-600" suppressHydrationWarning>
          {item.count.toLocaleString('tr-TR')} ({item.pct}%)
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
