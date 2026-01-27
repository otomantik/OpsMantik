/**
 * Iron Dome v2.1 - Phase 7: Realtime Pulse
 * 
 * Centralized realtime hook for dashboard updates with:
 * - Strict scope (site-specific)
 * - Idempotent optimistic updates
 * - Event deduplication
 * - Connection status tracking
 */

'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';
import { IntentRow } from './use-intents';
import { isDebugEnabled } from '@/lib/utils';

// Realtime Event Types
export type DashboardEvent =
  | { type: 'intent_created'; data: IntentRow; eventId: string }
  | { type: 'intent_updated'; data: Partial<IntentRow> & { id: string }; eventId: string }
  | { type: 'session_heartbeat'; data: { session_id: string; site_id: string }; eventId: string }
  | { type: 'conversion_sealed'; data: { intent_id: string; sealed_at: Date }; eventId: string }
  | { type: 'data_freshness'; data: { last_event_at: Date }; eventId: string }
  | { type: 'call_created'; data: any; eventId: string }
  | { type: 'call_updated'; data: Partial<any> & { id: string }; eventId: string }
  | { type: 'event_created'; data: any; eventId: string };

export interface RealtimeDashboardState {
  isConnected: boolean;
  lastEventAt: Date | null;
  eventCount: number;
  error: string | null;
}

export interface RealtimeDashboardCallbacks {
  onIntentCreated?: (intent: IntentRow) => void;
  onIntentUpdated?: (intent: Partial<IntentRow> & { id: string }) => void;
  onCallCreated?: (call: any) => void;
  onCallUpdated?: (call: Partial<any> & { id: string }) => void;
  onEventCreated?: (event: any) => void;
  onDataFreshness?: (lastEventAt: Date) => void;
}

export interface RealtimeDashboardOptions {
  /**
   * ADS Command Center mode:
   * - non-ads payloads are NOT injected
   * - if Ads-ness cannot be decided, do not inject; optionally trigger refetch via onDataFreshness
   */
  adsOnly?: boolean;
}

type AdsDecision =
  | { kind: 'ads'; reason: string }
  | { kind: 'non_ads'; reason: string }
  | { kind: 'unknown'; reason: string };

export function useRealtimeDashboard(
  siteId: string | undefined,
  callbacks?: RealtimeDashboardCallbacks,
  options?: RealtimeDashboardOptions
) {
  const [state, setState] = useState<RealtimeDashboardState>({
    isConnected: false,
    lastEventAt: null,
    eventCount: 0,
    error: null,
  });

  const subscriptionRef = useRef<RealtimeChannel | null>(null);
  const processedEventsRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef<boolean>(true);
  const supabaseRef = useRef(createClient());
  const callbacksRef = useRef<RealtimeDashboardCallbacks | undefined>(callbacks);
  const optionsRef = useRef<RealtimeDashboardOptions | undefined>(options);
  const adsCacheRef = useRef<Map<string, boolean>>(new Map()); // session_id -> isAds
  
  // Update callbacks ref when callbacks change
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  // Update options ref when options change
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Generate unique event ID for deduplication
  const generateEventId = useCallback((table: string, id: string, timestamp: string): string => {
    return `${table}:${id}:${timestamp}`;
  }, []);

  // Deduplication check
  const isDuplicate = useCallback((eventId: string): boolean => {
    if (processedEventsRef.current.has(eventId)) {
      // Log deduplication in development
      if (process.env.NODE_ENV === 'development') {
        console.log('[REALTIME] Duplicate event ignored:', eventId);
      }
      return true;
    }
    processedEventsRef.current.add(eventId);
    
    // Log new event in development
    if (process.env.NODE_ENV === 'development') {
      console.log('[REALTIME] New event processed:', eventId);
    }
    
    // Cleanup old events (keep last 1000)
    if (processedEventsRef.current.size > 1000) {
      const eventsArray = Array.from(processedEventsRef.current);
      processedEventsRef.current = new Set(eventsArray.slice(-500));
    }
    
    return false;
  }, []);

  const logAdsOnly = useCallback((message: string, extra?: any) => {
    if (!isDebugEnabled()) return;
    // Keep logs terse; they are only visible in dev or explicit debug mode.
    console.log('[REALTIME][ADS_ONLY]', message, extra || '');
  }, []);

  const getMetaField = useCallback((obj: any, key: string): string | null => {
    const v = obj?.[key];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    return null;
  }, []);

  const decideAdsFromPayload = useCallback((payload: any): AdsDecision => {
    // Prefer metadata fields; fall back to top-level if present
    const meta = payload?.metadata || payload?.meta || {};

    const gclid = getMetaField(meta, 'gclid') || getMetaField(payload, 'gclid');
    const wbraid = getMetaField(meta, 'wbraid') || getMetaField(payload, 'wbraid');
    const gbraid = getMetaField(meta, 'gbraid') || getMetaField(payload, 'gbraid');
    const attributionSource =
      getMetaField(meta, 'attribution_source') ||
      getMetaField(payload, 'attribution_source');
    const utmSource = getMetaField(meta, 'utm_source') || getMetaField(payload, 'utm_source');
    const utmMedium = getMetaField(meta, 'utm_medium') || getMetaField(payload, 'utm_medium');

    // If we have any click-id, it's Ads.
    if (gclid || wbraid || gbraid) {
      return { kind: 'ads', reason: 'click_id_present' };
    }

    // If we have UTM medium that implies paid search, it's Ads.
    if (utmMedium) {
      const m = utmMedium.toLowerCase();
      if (['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'ads'].includes(m)) {
        return { kind: 'ads', reason: `utm_medium=${m}` };
      }
    }

    // If attribution_source is explicitly present, treat known ads-ish sources as Ads.
    if (attributionSource) {
      const s = attributionSource.toLowerCase();
      if (s.includes('ads') || s.includes('google') || s.includes('gads') || s.includes('adwords')) {
        return { kind: 'ads', reason: `attribution_source=${s}` };
      }
      // We can decide non-ads if attribution_source is present and not ads-like.
      return { kind: 'non_ads', reason: `attribution_source=${s}` };
    }

    // If we got here and at least one UTM field exists, we can decide non-ads (no paid medium)
    if (utmSource || utmMedium) {
      return { kind: 'non_ads', reason: 'utm_present_no_paid_signal' };
    }

    return { kind: 'unknown', reason: 'insufficient_payload_fields' };
  }, [getMetaField]);

  const cacheSet = useCallback((sessionId: string, isAds: boolean) => {
    adsCacheRef.current.set(sessionId, isAds);
    // Cap cache size
    if (adsCacheRef.current.size > 500) {
      const keys = Array.from(adsCacheRef.current.keys());
      for (const k of keys.slice(0, 250)) adsCacheRef.current.delete(k);
    }
  }, []);

  const isAdsSessionByLookup = useCallback(async (sid: string): Promise<'ads' | 'non_ads' | 'error'> => {
    const cached = adsCacheRef.current.get(sid);
    if (typeof cached === 'boolean') return cached ? 'ads' : 'non_ads';

    try {
      const supabase = supabaseRef.current;
      const { data: rows, error } = await supabase.rpc('get_session_details', {
        p_site_id: siteId,
        p_session_id: sid,
      });
      if (error) return 'error';
      const isAds = !!(rows && Array.isArray(rows) && rows.length > 0);
      cacheSet(sid, isAds);
      return isAds ? 'ads' : 'non_ads';
    } catch {
      return 'error';
    }
  }, [cacheSet, siteId]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!siteId) {
      setState(prev => ({ ...prev, isConnected: false, error: 'No site ID provided' }));
      return;
    }

    isMountedRef.current = true;
    const supabase = supabaseRef.current;

    // Cleanup existing subscription
    if (subscriptionRef.current) {
      supabase.removeChannel(subscriptionRef.current);
      subscriptionRef.current = null;
    }

    // Create site-specific channel
    const channelName = `dashboard_updates:${siteId}`;
    
    // Log site scoping in development
    if (process.env.NODE_ENV === 'development') {
      console.log('[REALTIME] Subscribing to site-specific channel:', channelName);
      console.log('[REALTIME] Site filter applied: site_id=eq.' + siteId);
    }
    
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'calls',
          filter: `site_id=eq.${siteId}`, // Site-scoped filter
        },
        (payload) => {
          if (!isMountedRef.current) return;

          const newCall = payload.new as any;
          
          // Verify site_id matches (defense in depth)
          if (newCall.site_id !== siteId) {
            if (process.env.NODE_ENV === 'development') {
              console.warn('[REALTIME] Cross-site event blocked:', newCall.site_id, '!==', siteId);
            }
            return;
          }
          
          const eventId = generateEventId('calls', newCall.id, payload.commit_timestamp || new Date().toISOString());

          // Deduplication
          if (isDuplicate(eventId)) {
            return;
          }

          const adsOnly = optionsRef.current?.adsOnly === true;
          if (adsOnly) {
            // Rule: ignore calls we cannot confidently attribute to Ads sessions.
            const sid = newCall?.matched_session_id;
            if (!sid || typeof sid !== 'string') {
              logAdsOnly('call_created ignored (no matched_session_id)', { callId: newCall?.id });
              // unknown => rely on bounded refetch only if caller wants it
              callbacksRef.current?.onDataFreshness?.(new Date());
              return;
            }
            // Lookup gate (get_session_details is ads-only)
            isAdsSessionByLookup(sid).then((res) => {
              if (!isMountedRef.current) return;
              if (res === 'ads') {
                callbacksRef.current?.onCallCreated?.(newCall);
                setState(prev => ({
                  ...prev,
                  lastEventAt: new Date(),
                  eventCount: prev.eventCount + 1,
                }));
              } else if (res === 'non_ads') {
                logAdsOnly('call_created ignored (non-ads matched session)', { callId: newCall?.id, sessionId: sid });
              } else {
                logAdsOnly('call_created unknown (lookup error) -> refetch_only', { callId: newCall?.id, sessionId: sid });
                callbacksRef.current?.onDataFreshness?.(new Date());
              }
            });
            return;
          }

          // Non-ads mode: pass through
          callbacksRef.current?.onCallCreated?.(newCall);

          setState(prev => ({
            ...prev,
            lastEventAt: new Date(),
            eventCount: prev.eventCount + 1,
          }));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `site_id=eq.${siteId}`, // Site-scoped filter
        },
        (payload) => {
          if (!isMountedRef.current) return;

          const updatedCall = payload.new as any;
          
          // Verify site_id matches (defense in depth)
          if (updatedCall.site_id !== siteId) {
            if (process.env.NODE_ENV === 'development') {
              console.warn('[REALTIME] Cross-site event blocked:', updatedCall.site_id, '!==', siteId);
            }
            return;
          }
          
          const eventId = generateEventId('calls', updatedCall.id, payload.commit_timestamp || new Date().toISOString());

          // Deduplication
          if (isDuplicate(eventId)) {
            return;
          }

          const adsOnly = optionsRef.current?.adsOnly === true;
          if (adsOnly) {
            const sid = updatedCall?.matched_session_id;
            if (!sid || typeof sid !== 'string') {
              logAdsOnly('call_updated ignored (no matched_session_id)', { callId: updatedCall?.id });
              callbacksRef.current?.onDataFreshness?.(new Date());
              return;
            }
            isAdsSessionByLookup(sid).then((res) => {
              if (!isMountedRef.current) return;
              if (res === 'ads') {
                callbacksRef.current?.onCallUpdated?.(updatedCall);
                setState(prev => ({
                  ...prev,
                  lastEventAt: new Date(),
                  eventCount: prev.eventCount + 1,
                }));
              } else if (res === 'non_ads') {
                logAdsOnly('call_updated ignored (non-ads matched session)', { callId: updatedCall?.id, sessionId: sid });
              } else {
                logAdsOnly('call_updated unknown (lookup error) -> refetch_only', { callId: updatedCall?.id, sessionId: sid });
                callbacksRef.current?.onDataFreshness?.(new Date());
              }
            });
            return;
          }

          callbacksRef.current?.onCallUpdated?.(updatedCall);

          setState(prev => ({
            ...prev,
            lastEventAt: new Date(),
            eventCount: prev.eventCount + 1,
          }));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'events',
        },
        async (payload) => {
          if (!isMountedRef.current) return;

          const newEvent = payload.new as any;
          const adsOnly = optionsRef.current?.adsOnly === true;
          if (adsOnly) {
            // First try payload-only signal; if unknown, do lookup.
            const signal = decideAdsFromPayload(newEvent);
            if (signal.kind === 'non_ads') {
              logAdsOnly('event_created ignored (payload non-ads)', { eventId: newEvent?.id, reason: signal.reason });
              return;
            }

            const sid = newEvent?.session_id;
            if (!sid || typeof sid !== 'string') {
              logAdsOnly('event_created unknown (no session_id) -> refetch_only', { eventId: newEvent?.id });
              callbacksRef.current?.onDataFreshness?.(new Date());
              return;
            }

            // Lookup is authoritative (ads-only + site-scoped)
            const lookup = await isAdsSessionByLookup(sid);
            if (lookup === 'non_ads') {
              logAdsOnly('event_created ignored (lookup non-ads)', { eventId: newEvent?.id, sessionId: sid });
              return;
            }
            if (lookup === 'error') {
              // Unknown -> do not inject; rely on bounded refetch from RPCs (ads-only) for correctness
              logAdsOnly('event_created unknown (lookup error) -> refetch_only', { eventId: newEvent?.id, sessionId: sid });
              callbacksRef.current?.onDataFreshness?.(new Date());
              return;
            }
            // lookup === 'ads' => proceed
          } else {
            // Non-ads mode (legacy): if we can't verify, we ignore optimistic injection to avoid cross-site leaks.
            // Note: in current ADS Command Center scope, callers should set adsOnly=true.
            const sid = newEvent?.session_id;
            if (!sid || typeof sid !== 'string') return;
            const lookup = await isAdsSessionByLookup(sid);
            if (lookup !== 'ads') return;
          }

          const eventId = generateEventId('events', newEvent.id, payload.commit_timestamp || new Date().toISOString());

          // Deduplication
          if (isDuplicate(eventId)) {
            return;
          }

          if (callbacksRef.current?.onEventCreated) {
            callbacksRef.current.onEventCreated(newEvent);
          }

          // Update data freshness
          if (callbacksRef.current?.onDataFreshness) {
            callbacksRef.current.onDataFreshness(new Date());
          }

          setState(prev => ({
            ...prev,
            lastEventAt: new Date(),
            eventCount: prev.eventCount + 1,
          }));
        }
      )
      .subscribe((status) => {
        if (!isMountedRef.current) return;

        if (status === 'SUBSCRIBED') {
          setState(prev => ({
            ...prev,
            isConnected: true,
            error: null,
          }));
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setState(prev => ({
            ...prev,
            isConnected: false,
            error: `Connection error: ${status}`,
          }));
        } else if (status === 'CLOSED') {
          setState(prev => ({
            ...prev,
            isConnected: false,
          }));
        }
      });

    subscriptionRef.current = channel;

    return () => {
      isMountedRef.current = false;
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [siteId, generateEventId, isDuplicate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (subscriptionRef.current) {
        supabaseRef.current.removeChannel(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, []);

  return {
    ...state,
    reconnect: useCallback(() => {
      if (subscriptionRef.current) {
        supabaseRef.current.removeChannel(subscriptionRef.current);
        subscriptionRef.current = null;
      }
      // Trigger re-subscription by updating state
      setState(prev => ({ ...prev, isConnected: false }));
    }, []),
  };
}
