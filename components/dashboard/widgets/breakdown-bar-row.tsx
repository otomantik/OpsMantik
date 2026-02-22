'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';
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
  const { formatNumber, t } = useTranslation();
  const rawLabel = decodeLabel ? safeDecode(item.name) : item.name;

  // Professional i18n: Map database-level dimension values to localized labels
  const getLocalizedLabel = (raw: string) => {
    const l = raw.toLowerCase().trim();
    if (l === 'mobile') return t('device.mobile');
    if (l === 'desktop') return t('device.desktop');
    if (l === 'tablet') return t('device.tablet');
    if (l === 'social') return t('dimension.social');
    if (l === 'direct') return t('dimension.direct');
    if (l === 'seo') return t('dimension.seo');
    if (l === 'google ads') return t('dimension.googleAds');
    return fixMojibake(raw);
  };

  const label = getLocalizedLabel(rawLabel);
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
