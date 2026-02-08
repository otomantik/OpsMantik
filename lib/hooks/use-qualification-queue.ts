'use client';

import { useEffect, useMemo } from 'react';
import { useQueueController, type QueueRange } from './use-queue-controller';

export type QualificationQueueFilters = {
  range: QueueRange;
};

/**
 * High-level hook for the Qualification Queue UI.
 * Wraps the lower-level controller hook and exposes a UI-friendly API:
 * - data: queue data + derived fields
 * - isLoading / error: request states
 * - filters / setFilters: range (and future filters)
 * - handlers: all user actions (seal/junk/undo/cancel/open drawer/etc.)
 *
 * Note: Logic is intentionally delegated to `useQueueController` to avoid
 * duplicate state machines and keep behavior identical.
 */
export function useQualificationQueue({
  siteId,
  range,
}: {
  siteId: string;
  range: QueueRange;
}): {
  data: ReturnType<typeof useQueueController>['state'];
  isLoading: boolean;
  error: string | null;
  filters: QualificationQueueFilters;
  setFilters: { setRange: (next: QueueRange) => void };
  handlers: ReturnType<typeof useQueueController>['actions'];
} {
  const { state, actions } = useQueueController(siteId);

  // Keep range as prop, but sync to controller (controller owns side effects).
  useEffect(() => {
    actions.setRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.day, range.fromIso, range.toIso, siteId]);

  const filters = useMemo<QualificationQueueFilters>(() => ({ range }), [range]);

  return {
    data: state,
    isLoading: state.loading,
    error: state.error,
    filters,
    setFilters: { setRange: actions.setRange },
    handlers: actions,
  };
}

