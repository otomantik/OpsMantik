'use client';

import { Phone, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface IntentTypeBadgeProps {
  type: 'call' | 'conversion';
}

export function IntentTypeBadge({ type }: IntentTypeBadgeProps) {
  if (type === 'call') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Phone className="h-4 w-4" />
        Çağrı
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="gap-1">
      <TrendingUp className="h-4 w-4" />
      Dönüşüm
    </Badge>
  );
}
