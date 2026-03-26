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
        onOptimisticRemove={actions.optimisticRemove}
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
          <div className="grid grid-cols-1 gap-2 text-sm text-slate-600 sm:grid-cols-2 sm:gap-6">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{t('dashboard.intents')}</div>
              <div className="tabular-nums font-semibold text-slate-900">{t('dashboard.commandCenter.queue.inQueue', { n: state.intents.length })}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{t('crm.preview.nextStep')}</div>
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
    </div>
  );
}

