'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';

export function QueueLoadingState({ queueMeta }: { queueMeta: React.ReactNode }) {
  return (
    <>
      {queueMeta}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Intent Qualification Queue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    </>
  );
}

export function QueueErrorState({
  queueMeta,
  error,
  onRetry,
}: {
  queueMeta: React.ReactNode;
  error: string;
  onRetry: () => void;
}) {
  return (
    <>
      {queueMeta}
      <Card className="border border-rose-200 bg-rose-50">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Icons.alert className="w-10 h-10 text-rose-600 mb-2" />
          <p className="text-rose-800 text-sm mb-4">Failed to load intents: {error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRetry()}
            className="bg-background border-rose-300 text-rose-800 hover:bg-rose-100"
          >
            <Icons.refresh className="w-3 h-3 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

export function QueueEmptyState({
  queueMeta,
  day,
  onRefresh,
}: {
  queueMeta: React.ReactNode;
  day: 'today' | 'yesterday';
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {queueMeta}
      <Card className="border-2 border-dashed border-border bg-muted/20">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Icons.check className="w-16 h-16 text-green-500 mb-4" />
          <h3 className="text-xl font-semibold mb-2" data-testid="queue-empty-state">
            {day === 'yesterday' ? t('empty.noDataYesterday') : t('empty.queueMissionAccomplished')}
          </h3>
          <p className="text-muted-foreground max-w-md">
            {day === 'yesterday' ? t('empty.noDataYesterdayDesc') : t('empty.noDataTodayDesc')}
          </p>
          <p className="text-muted-foreground text-xs mt-2 max-w-md">{t('empty.useRefresh')}</p>
          <Button variant="ghost" size="sm" onClick={() => onRefresh()} className="mt-4">
            <Icons.refresh className="w-4 h-4 mr-2" />
            {t('button.refresh')}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

export function QueueToast({
  toast,
}: {
  toast: null | { kind: 'success' | 'danger'; text: string };
}) {
  if (!toast) return null;
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-sm font-medium',
        toast.kind === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-red-200 bg-red-50 text-red-800'
      )}
    >
      {toast.text}
    </div>
  );
}

