'use client';

import { CheckCircle2, Clock, XCircle, AlertTriangle } from 'lucide-react';
import { IntentStatus } from '@/lib/hooks/use-intents';
import { formatTimestamp } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { strings } from '@/lib/i18n/en';

interface IntentStatusBadgeProps {
  status: IntentStatus;
  sealedAt: string | null;
}

export function IntentStatusBadge({ status, sealedAt }: IntentStatusBadgeProps) {
  if (status === 'confirmed' || status === 'qualified' || status === 'real') {
    return (
      <div className="flex flex-col gap-1">
        <Badge variant="secondary" className="gap-1">
          <CheckCircle2 className="h-4 w-4" />
          {strings.statusSealed}
        </Badge>
        {sealedAt && (
          <span className="text-sm text-muted-foreground tabular-nums" suppressHydrationWarning>
            {formatTimestamp(sealedAt, { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    );
  }

  if (status === 'junk') {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-4 w-4" />
        {strings.statusJunk}
      </Badge>
    );
  }

  if (status === 'suspicious') {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-4 w-4" />
        {strings.statusSuspicious}
      </Badge>
    );
  }

  // pending (intent or null)
  return (
    <Badge variant="muted" className="gap-1">
      <Clock className="h-4 w-4" />
      {strings.statusPending}
    </Badge>
  );
}
