'use client';

import { Phone, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { strings } from '@/lib/i18n/en';

interface IntentTypeBadgeProps {
  type: 'call' | 'conversion';
}

export function IntentTypeBadge({ type }: IntentTypeBadgeProps) {
  if (type === 'call') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Phone className="h-4 w-4" />
        {strings.typeCall}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="gap-1">
      <TrendingUp className="h-4 w-4" />
      {strings.typeConversion}
    </Badge>
  );
}
