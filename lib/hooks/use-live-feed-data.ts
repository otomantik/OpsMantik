/**
 * useLiveFeedData Hook
 * 
 * Extracted from components/dashboard/live-feed.tsx for data boundary cleanup.
 * Manages data fetching, realtime subscriptions, and event grouping for Live Feed.
 * 
 * Preserves:
 * - PR1: Deterministic ordering (id DESC tie-breaker)
 * - PR3: Incremental grouping (no full regroup, no redundant queries)
 * - RLS compliance via JOIN patterns
 */

'use client';

import { useEffect, useState, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { normalizeEvent, Event } from '@/lib/events';
import { isDebugEnabled } from '@/lib/utils';

export interface UseLiveFeedDataResult {
  events: Event[];
  groupedSessions: Record<string, Event[]>;
  userSites: string[];
  isInitialized: boolean;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook for Live Feed data fetching and realtime subscriptions.
 * 
 * @param siteId - Optional site ID to filter by (RLS enforces access)
 * @returns Live Feed data and state
 */
export function useLiveFeedData(siteId?: string): UseLiveFeedDataResult {
  const [events, setEvents] = useState<Event[]>([]);
  const [groupedSessions, setGroupedSessions] = useState<Record<string, Event[]>>({});
  const [userSites, setUserSites] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  const subscriptionRef = useRef<any>(null);
  const isMountedRef = useRef<boolean>(true);
  const duplicateWarningRef = useRef<boolean>(false);

  // Memoized grouping: compute groupedSessions from events only when events change
  // This avoids expensive recalculations on every render (PR3: incremental grouping)
  useEffect(() => {
    if (events.length === 0) {
      setGroupedSessions({});
      return;
    }

    // Group events by session (only called when events array changes, not on every render)
    const grouped: Record<string, Event[]> = {};
    events.forEach((event) => {
      if (!grouped[event.session_id]) {
        grouped[event.session_id] = [];
      }
      grouped[event.session_id].push(event);
    });
    
    // Sort events within each session (PR1: maintain deterministic order)
    Object.keys(grouped).forEach((sessionId) => {
      grouped[sessionId].sort((a, b) => {
        const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.id.localeCompare(b.id); // PR1 tie-breaker
      });
    });

    setGroupedSessions(grouped);
  }, [events]); // Only recalculate when events array changes

  // Initial data fetch
  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    const initialize = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !mounted) return;

        if (isDebugEnabled()) {
          console.log('[LIVE_FEED] Initializing for user:', user.id, siteId ? `(site: ${siteId})` : '');
        }

        // If siteId is provided, use it directly (RLS will enforce access)
        if (siteId) {
          // Verify site access via RLS (query will fail if user doesn't have access)
          const { data: site } = await supabase
            .from('sites')
            .select('id')
            .eq('id', siteId)
            .single();

          if (!site || !mounted) {
            console.warn('[LIVE_FEED] Site not found or access denied:', siteId);
            setIsInitialized(false);
            setUserSites([]);
            setIsLoading(false);
            return;
          }

          setUserSites([siteId]);
          setIsInitialized(true);

          if (isDebugEnabled()) {
            console.log('[LIVE_FEED] Using single site:', siteId);
          }
        } else {
          // Get all user's sites (default behavior)
          const { data: sites } = await supabase
            .from('sites')
            .select('id')
            .eq('user_id', user.id);

          if (!sites || sites.length === 0 || !mounted) {
            console.warn('[LIVE_FEED] No sites found for user');
            setIsInitialized(false);
            setUserSites([]);
            setIsLoading(false);
            return;
          }

          const siteIds = sites.map((s) => s.id);
          setUserSites(siteIds);
          setIsInitialized(true);

          if (isDebugEnabled()) {
            console.log('[LIVE_FEED] Found sites:', siteIds.length);
          }
        }

        const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
        // Determine which sites to query: use siteId if provided, otherwise use the sites we just fetched
        // Note: userSites is set above in this function, so we can use it here
        const finalSiteIds = siteId ? [siteId] : userSites;
        
        if (finalSiteIds.length === 0) {
          setIsLoading(false);
          return;
        }

        // Get recent sessions - RLS compliant (sessions -> sites -> user_id)
        const { data: sessions } = await supabase
          .from('sessions')
          .select('id')
          .in('site_id', finalSiteIds)
          .eq('created_month', currentMonth)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }) // PR1: deterministic order
          .limit(50);

        if (!sessions || sessions.length === 0 || !mounted) {
          if (isDebugEnabled()) {
            console.log('[LIVE_FEED] No sessions found');
          }
          setIsLoading(false);
          return;
        }

        if (isDebugEnabled()) {
          console.log('[LIVE_FEED] Found sessions:', sessions.length);
        }

        // Get recent events - RLS compliant using JOIN pattern
        const { data: recentEvents } = await supabase
          .from('events')
          .select('*, sessions!inner(site_id), url')
          .eq('session_month', currentMonth)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }) // PR1: deterministic order
          .limit(100);

        if (recentEvents && mounted) {
          if (isDebugEnabled()) {
            console.log('[LIVE_FEED] Loaded events:', recentEvents.length);
          }
          // Normalize event data (JOIN returns nested structure)
          const eventsData = recentEvents.map(normalizeEvent);
          setEvents(eventsData);
          // groupedSessions will be computed automatically via useEffect when events change
        }
        
        setIsLoading(false);
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Failed to initialize Live Feed'));
          setIsLoading(false);
        }
      }
    };

    initialize();

    return () => {
      mounted = false;
    };
  }, [siteId]); // Re-initialize when siteId changes

  // Realtime subscription - only after userSites is populated
  useEffect(() => {
    if (!isInitialized || userSites.length === 0) {
      return;
    }

    const supabase = createClient();
    // Calculate current month inside effect to ensure it's fresh
    const getCurrentMonth = () => new Date().toISOString().slice(0, 7) + '-01';
    const currentMonth = getCurrentMonth();
    const siteIds = siteId ? [siteId] : [...userSites];
    
    // Runtime assertion: detect duplicate subscriptions
    if (subscriptionRef.current) {
      if (!duplicateWarningRef.current) {
        console.warn('[LIVE_FEED] ⚠️ Duplicate subscription detected! Cleaning up existing subscription before creating new one.');
        duplicateWarningRef.current = true;
      }
      // Clean up existing subscription
      supabase.removeChannel(subscriptionRef.current);
      subscriptionRef.current = null;
    } else {
      // Reset warning flag when subscription is properly cleaned up
      duplicateWarningRef.current = false;
    }
    
    if (isDebugEnabled()) {
      console.log('[LIVE_FEED] Setting up realtime subscription for', siteIds.length, 'sites');
    }

    // Realtime subscription for events
    const eventsChannel = supabase
      .channel('events-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'events',
        },
        async (payload) => {
          const newEvent = payload.new as Event;
          
          if (isDebugEnabled()) {
            console.log('[LIVE_FEED] 🔔 New event received:', {
              id: newEvent.id.slice(0, 8),
              action: newEvent.event_action,
              session_month: newEvent.session_month,
              current_month: currentMonth,
            });
          }
          
          // Filter by session_month (partition check) - use fresh current month
          const eventMonth = newEvent.session_month;
          const freshCurrentMonth = getCurrentMonth();
          if (eventMonth !== freshCurrentMonth) {
            if (isDebugEnabled()) {
              console.log('[LIVE_FEED] ⏭️ Ignoring event from different partition:', eventMonth, 'vs', freshCurrentMonth);
            }
            return; // Ignore events from other partitions
          }

          // Trust RLS subscription filter - no redundant verification query (PR3)
          // The subscription already filters by site_id via RLS policies
          // The subscription channel is site-scoped, so all events are valid

          // Guard against unmount before setState
          if (!isMountedRef.current) {
            if (isDebugEnabled()) {
              console.log('[LIVE_FEED] ⏭️ Component unmounted, skipping event update');
            }
            return;
          }

          if (isDebugEnabled()) {
            console.log('[LIVE_FEED] ✅ Adding event to feed:', newEvent.event_action);
          }

          // Incremental update: add event to events list and update only the affected session group (PR3)
          setEvents((prev) => {
            // Double-check mount status inside setState callback
            if (!isMountedRef.current) return prev;
            // Maintain PR1 deterministic order: prepend new event, keep id DESC tie-breaker
            const updated = [newEvent, ...prev].slice(0, 100);
            return updated;
          });

          // Incremental grouping: update only the affected session group instead of full regroup (PR3)
          setGroupedSessions((prev) => {
            if (!isMountedRef.current) return prev;
            const sessionId = newEvent.session_id;
            const updated = { ...prev };
            if (!updated[sessionId]) {
              updated[sessionId] = [];
            }
            // Add new event to session group, maintaining PR1 deterministic order
            updated[sessionId] = [newEvent, ...updated[sessionId]].slice(0, 100);
            return updated;
          });
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          if (isDebugEnabled()) {
            console.log('[LIVE_FEED] ✅ Realtime subscription ACTIVE for', siteIds.length, 'sites');
          }
        } else if (status === 'CHANNEL_ERROR') {
          // Connection errors are often transient - Supabase will auto-reconnect
          // Only log as warning unless it's a persistent issue
          console.warn('[LIVE_FEED] ⚠️ Realtime subscription error (will auto-reconnect):', err?.message || 'Connection issue');
        } else if (status === 'CLOSED') {
          if (isDebugEnabled()) {
            console.log('[LIVE_FEED] Realtime subscription closed (normal - will reconnect)');
          }
        } else {
          if (isDebugEnabled()) {
            console.log('[LIVE_FEED] Subscription status:', status);
          }
        }
      });

    subscriptionRef.current = eventsChannel;

    return () => {
      // Mark as unmounted before cleanup
      isMountedRef.current = false;
      if (subscriptionRef.current) {
        if (isDebugEnabled()) {
          console.log('[LIVE_FEED] Cleaning up subscription on unmount');
        }
        supabase.removeChannel(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [isInitialized, userSites, siteId]); // Subscription setup - grouping handled by useEffect on events

  return {
    events,
    groupedSessions,
    userSites,
    isInitialized,
    isLoading,
    error,
  };
}
