'use client';

import React, { useMemo } from 'react';
import { QueueHeader } from './QualificationQueue/QueueHeader';
import { QueueErrorState, QueueLoadingState, QueueToast } from './QualificationQueue/QueueStates';
import { QueueEmptyState } from './QualificationQueue/QueueEmptyState';
import { QueueList } from './QualificationQueue/QueueList';
import { ActionModals } from './QualificationQueue/ActionModals';
import { useQualificationQueue } from '@/lib/hooks/useQualificationQueue';

export interface QualificationQueueProps {
  siteId: string;
  range: { day: 'today' | 'yesterday'; fromIso: string; toIso: string };
}

export const QualificationQueue: React.FC<QualificationQueueProps> = ({ siteId, range }) => {
  const { data: state, handlers: actions, isLoading, error } = useQualificationQueue({ siteId, range });

  const queueMeta = useMemo(
    () => (
      <>
        <div
          data-testid="queue-range"
          data-day={range.day}
          data-from={range.fromIso}
          data-to={range.toIso}
          data-ads-only="0"
          className="sr-only"
        />
        <div data-testid="queue-top-created-at" className="sr-only">
          {state.top?.created_at || ''}
        </div>
      </>
    ),
    [range.day, range.fromIso, range.toIso, state.top?.created_at]
  );

  if (isLoading) {
    return <QueueLoadingState queueMeta={queueMeta} />;
  }

  if (error) {
    return <QueueErrorState queueMeta={queueMeta} error={error} onRetry={() => actions.fetchUnscoredIntents()} />;
  }

  if (state.intents.length === 0) {
    return (
      <>
        <QueueEmptyState queueMeta={queueMeta} day={range.day} onRefresh={() => actions.fetchUnscoredIntents()} />
        <ActionModals siteId={siteId} state={state} actions={actions} />
      </>
    );
  }

  return (
    <>
      <QueueHeader queueMeta={queueMeta} toast={<QueueToast toast={state.toast} />} />
      <QueueList siteId={siteId} state={state} actions={actions} />
      <ActionModals siteId={siteId} state={state} actions={actions} />
    </>
  );
};
