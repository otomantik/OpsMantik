'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';

type RegisterQueueRefetch = (fn: () => void) => () => void;

export type SiteRealtimeDashboardContextValue = ReturnType<typeof useRealtimeDashboard> & {
  registerQueueRefetch: RegisterQueueRefetch;
};

const SiteRealtimeDashboardContext = createContext<SiteRealtimeDashboardContextValue | null>(null);

/**
 * Owns a single `useRealtimeDashboard` subscription per site (holistic / adsOnly: false)
 * for the command-center shell + qualification queue. Queue widgets register refetch
 * callbacks here instead of opening a second Supabase channel.
 */
export function SiteRealtimeDashboardProvider({
  siteId,
  children,
}: {
  siteId: string;
  children: React.ReactNode;
}) {
  const listenersRef = useRef(new Set<() => void>());

  const registerQueueRefetch = useCallback<RegisterQueueRefetch>((fn) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  const notifyQueueRefetches = useCallback(() => {
    for (const fn of listenersRef.current) {
      try {
        fn();
      } catch {
        /* subscriber errors must not break the realtime channel */
      }
    }
  }, []);

  const callbacks = useMemo(
    () => ({
      onCallCreated: notifyQueueRefetches,
      onCallUpdated: notifyQueueRefetches,
    }),
    [notifyQueueRefetches],
  );

  const realtime = useRealtimeDashboard(siteId, callbacks, { adsOnly: false });

  const value = useMemo(
    (): SiteRealtimeDashboardContextValue => ({
      ...realtime,
      registerQueueRefetch,
    }),
    [realtime, registerQueueRefetch],
  );

  return (
    <SiteRealtimeDashboardContext.Provider value={value}>{children}</SiteRealtimeDashboardContext.Provider>
  );
}

export function useSiteRealtimeDashboard(): SiteRealtimeDashboardContextValue {
  const ctx = useContext(SiteRealtimeDashboardContext);
  if (!ctx) {
    throw new Error('useSiteRealtimeDashboard must be used within SiteRealtimeDashboardProvider');
  }
  return ctx;
}

/** Queue refetch on call INSERT/UPDATE; shares the provider-owned channel. */
export function useRegisterSiteRealtimeQueueRefetch(onRefetch: () => void): void {
  const ctx = useContext(SiteRealtimeDashboardContext);
  const onRefetchRef = useRef(onRefetch);
  onRefetchRef.current = onRefetch;

  useEffect(() => {
    if (!ctx) return undefined;
    const wrapped = () => {
      onRefetchRef.current();
    };
    return ctx.registerQueueRefetch(wrapped);
  }, [ctx]);
}
