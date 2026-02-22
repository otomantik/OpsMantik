'use client';

import { Phone, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface IntentTypeBadgeProps {
  type: 'call' | 'conversion';
}

export function IntentTypeBadge({ type }: IntentTypeBadgeProps) {
  const { t } = useTranslation();
  if (type === 'call') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Phone className="h-4 w-4" />
        {t('intent.call')}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="gap-1">
      <TrendingUp className="h-4 w-4" />
      {t('intent.conversion')}
    </Badge>
  );
}
