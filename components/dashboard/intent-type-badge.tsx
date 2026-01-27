'use client';

import { Phone, TrendingUp } from 'lucide-react';

interface IntentTypeBadgeProps {
  type: 'call' | 'conversion';
}

export function IntentTypeBadge({ type }: IntentTypeBadgeProps) {
  if (type === 'call') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-[10px] font-mono text-blue-400">
        <Phone className="h-3 w-3" />
        Çağrı
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-mono text-emerald-400">
      <TrendingUp className="h-3 w-3" />
      Dönüşüm
    </span>
  );
}
