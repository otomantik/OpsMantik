'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { formatTimestamp } from '@/lib/utils';
import { QueueDeck } from './queue-deck';
import { ActivityLogInline } from './activity-log-inline';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { QueueControllerActions, QueueControllerState } from '@/lib/hooks/use-queue-controller';

export function QueueList({
  siteId,
  state,
  actions,
  readOnly,
}: {
  siteId: string;
  state: QueueControllerState;
  actions: QueueControllerActions;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <QueueDeck
        siteId={siteId}
        mergedTop={state.mergedTop}
        topLite={state.top}
        mergedNext={state.mergedNext}
        readOnly={readOnly}
        onOpenDetails={actions.openDrawerWithLazyDetails}
        onQualified={actions.handleQualified}
        onSkip={actions.rotateSkip}
        onSealDeal={() => {
          if (!state.mergedTop) return;
          if (readOnly) {
            actions.pushToast('danger', t('dashboard.commandCenter.queue.readOnlyJunk'));
            return;
          }
          actions.openSealModal(state.mergedTop);
        }}
        pushToast={actions.pushToast}
        pushHistoryRow={actions.pushHistoryRow}
      />

      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant={state.showAll ? 'outline' : 'default'}
              size="sm"
              className="h-9"
              onClick={() => actions.setShowAll(false)}
            >
              Görülmemiş
            </Button>
            <Button
              variant={state.showAll ? 'default' : 'outline'}
              size="sm"
              className="h-9"
              onClick={() => actions.setShowAll(true)}
            >
              Tümü
            </Button>
            <Button
              variant={state.adsOnly ? 'default' : 'outline'}
              size="sm"
              className="h-9"
              onClick={() => actions.setAdsOnly(!state.adsOnly)}
            >
              Ads-only
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-2 text-sm text-slate-600 sm:grid-cols-2 sm:gap-6">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{t('dashboard.intents')}</div>
              <div className="tabular-nums font-semibold text-slate-900">{t('dashboard.commandCenter.queue.inQueue', { n: state.intents.length })}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{t('queue.focusTimeLabel')}</div>
              <div className="tabular-nums font-semibold text-slate-900" suppressHydrationWarning>
                {state.mergedTop
                  ? `${formatTimestamp(state.mergedTop.created_at, { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ${t('dashboard.commandCenter.queue.trt')}`
                  : '—'}
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" className="h-10 w-full sm:w-auto" onClick={() => actions.fetchUnscoredIntents()}>
            <Icons.refresh className="h-4 w-4 mr-2" />
            {t('button.refresh')}
          </Button>
          {state.top && (
            <Button
              variant="outline"
              size="sm"
              className="h-10 w-full sm:w-auto"
              disabled={readOnly}
              onClick={() => actions.markIntentReviewed(state.top!.id)}
            >
              Görüldü
            </Button>
          )}
        </div>
      </div>

      <ActivityLogInline
        history={state.history}
        restoringIds={state.restoringIds}
        onUndo={(id) => {
          if (readOnly) return;
          actions.undoLastAction(id);
        }}
        onCancel={(id) => {
          if (readOnly) return;
          actions.cancelDeal(id);
        }}
        readOnly={readOnly}
      />

      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">Girilenler (Son 50)</div>
        <div className="space-y-2">
          {state.recentEntered.slice(0, 50).map((row) => (
            <div key={row.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-xs">
              <span className="truncate pr-2">{row.intent_target || row.summary || row.id}</span>
              <span className="text-slate-500">{row.status || 'intent'}</span>
            </div>
          ))}
          {state.recentEntered.length === 0 && (
            <div className="text-xs text-slate-500">Henüz girilen kayıt yok.</div>
          )}
        </div>
      </div>
    </div>
  );
}

