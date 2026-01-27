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

export function useRealtimeDashboard(
  siteId: string | undefined,
  callbacks?: RealtimeDashboardCallbacks
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
  
  // Update callbacks ref when callbacks change
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

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

          // Transform to IntentRow if needed
          if (callbacksRef.current?.onCallCreated) {
            callbacksRef.current.onCallCreated(newCall);
          }

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

          if (callbacksRef.current?.onCallUpdated) {
            callbacksRef.current.onCallUpdated(updatedCall);
          }

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
          
          // Verify event belongs to site (need to check session)
          try {
            const { data: session } = await supabase
              .from('sessions')
              .select('site_id')
              .eq('id', newEvent.session_id)
              .single();

            if (!session || session.site_id !== siteId) {
              return; // Event not for this site
            }
          } catch {
            return; // Session not found or error
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
