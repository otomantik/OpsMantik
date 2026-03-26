'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';

export function QueueLoadingState({ queueMeta }: { queueMeta: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      {queueMeta}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">{t('queue.loadingTitle')}</CardTitle>
          <p className="text-sm text-slate-500">{t('queue.loadingSubtitle')}</p>
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
  const { t } = useTranslation();
  return (
    <>
      {queueMeta}
      <Card className="rounded-2xl border border-rose-200 bg-rose-50 shadow-sm">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Icons.alert className="w-10 h-10 text-rose-600 mb-2" />
          <h3 className="text-lg font-semibold text-rose-900">{t('queue.errorTitle')}</h3>
          <p className="mt-2 text-rose-800 text-sm max-w-md">{t('queue.errorSubtitle')}</p>
          <p className="mt-2 text-rose-700 text-sm mb-4">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRetry()}
            className="bg-background border-rose-300 text-rose-800 hover:bg-rose-100"
          >
            <Icons.refresh className="w-3 h-3 mr-2" />
            {t('button.retry')}
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
      <Card className="rounded-2xl border-2 border-dashed border-border bg-muted/20 shadow-sm">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Icons.check className="w-16 h-16 text-green-500 mb-4" />
          <h3 className="text-xl font-semibold mb-2" data-testid="queue-empty-state">
            {day === 'yesterday' ? t('queue.emptyYesterdayTitle') : t('queue.emptyTodayTitle')}
          </h3>
          <p className="text-muted-foreground max-w-md">
            {day === 'yesterday' ? t('queue.emptyYesterdaySubtitle') : t('queue.emptyTodaySubtitle')}
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

