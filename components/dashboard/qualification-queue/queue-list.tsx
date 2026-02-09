'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { formatTimestamp } from '@/lib/utils';
import { QueueDeck } from './queue-deck';
import { ActivityLogInline } from './activity-log-inline';
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
  return (
    <div className="space-y-3">
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
            actions.pushToast('danger', 'Read-only role: cannot seal/junk.');
            return;
          }
          actions.openSealModal(state.mergedTop);
        }}
        pushToast={actions.pushToast}
        pushHistoryRow={actions.pushHistoryRow}
      />

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div className="tabular-nums">{state.intents.length} in queue</div>
        {state.mergedTop && (
          <div className="tabular-nums" suppressHydrationWarning>
            {formatTimestamp(state.mergedTop.created_at, { hour: '2-digit', minute: '2-digit', second: '2-digit' })} TRT
          </div>
        )}
        <Button variant="ghost" size="sm" className="h-9" onClick={() => actions.fetchUnscoredIntents()}>
          <Icons.refresh className="h-4 w-4 mr-2" />
          Refresh
        </Button>
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

