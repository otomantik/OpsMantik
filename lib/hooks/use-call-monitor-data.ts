/**
 * useCallMonitorData Hook
 * 
 * Extracted from components/dashboard/call-alert-wrapper.tsx for data boundary cleanup.
 * Manages call fetching and realtime subscriptions for Call Monitor.
 * 
 * Preserves:
 * - PR1: Deterministic ordering (id DESC tie-breaker)
 * - PR3: No redundant RLS verification queries
 * - RLS compliance via JOIN patterns
 */

'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isDebugEnabled } from '@/lib/utils';

export interface Call {
  id: string;
  phone_number: string;
  matched_session_id: string | null;
  matched_fingerprint?: string | null;
  lead_score: number;
  lead_score_at_match?: number | null;
  score_breakdown?: {
    conversionPoints: number;
    interactionPoints: number;
    bonuses: number;
    cappedAt100: boolean;
    rawScore?: number;
    finalScore?: number;
  } | null;
  matched_at?: string | null;
  created_at: string;
  site_id: string;
  status?: string | null; // intent, confirmed, qualified, junk, real, null
  source?: string | null; // click, api, manual
  confirmed_at?: string | null;
  confirmed_by?: string | null;
}

export interface UseCallMonitorDataResult {
  calls: Call[];
  dismissed: Set<string>;
  newMatchIds: Set<string>;
  isLoading: boolean;
  error: Error | null;
  onDismiss: (id: string) => void;
}

/**
 * Hook for Call Monitor data fetching and realtime subscriptions.
 * 
 * @param siteId - Optional site ID to filter by (RLS enforces access)
 * @returns Call Monitor data and state
 */
export function useCallMonitorData(siteId?: string): UseCallMonitorDataResult {
  const [calls, setCalls] = useState<Call[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [userSites, setUserSites] = useState<string[]>([]);
  const [newMatchIds, setNewMatchIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  const previousCallIdsRef = useRef<Set<string>>(new Set());
  const subscriptionRef = useRef<any>(null);
  const isMountedRef = useRef<boolean>(true);
  const timeoutRefsRef = useRef<Set<NodeJS.Timeout>>(new Set());
  const duplicateWarningRef = useRef<boolean>(false);

  // Initial fetch
  useEffect(() => {
    const supabase = createClient();

    const fetchRecentCalls = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setIsLoading(false);
          return;
        }

        // If siteId is provided, use it directly (RLS will enforce access)
        if (siteId) {
          // Verify site access via RLS
          const { data: site } = await supabase
            .from('sites')
            .select('id')
            .eq('id', siteId)
            .single();

          if (!site) {
            setIsLoading(false);
            return;
          }

          setUserSites([siteId]);

          const { data: recentCalls } = await supabase
            .from('calls')
            .select('*')
            .eq('site_id', siteId)
            .in('status', ['intent', 'confirmed', 'qualified', 'real', null])
            .order('created_at', { ascending: false })
            .order('id', { ascending: false }) // PR1: deterministic order
            .limit(20);

          if (recentCalls) {
            setCalls(recentCalls as Call[]);
            previousCallIdsRef.current = new Set(recentCalls.map((c: Call) => c.id));
          }
        } else {
          // Get all user's sites (default behavior)
          const { data: sites } = await supabase
            .from('sites')
            .select('id')
            .eq('user_id', user.id);

          if (!sites || sites.length === 0) {
            setIsLoading(false);
            return;
          }

          const siteIds = sites.map(s => s.id);
          setUserSites(siteIds);

          const { data: recentCalls } = await supabase
            .from('calls')
            .select('*')
            .in('site_id', siteIds)
            .in('status', ['intent', 'confirmed', 'qualified', 'real', null])
            .order('created_at', { ascending: false })
            .order('id', { ascending: false }) // PR1: deterministic order
            .limit(20);

          if (recentCalls) {
            setCalls(recentCalls as Call[]);
            previousCallIdsRef.current = new Set(recentCalls.map((c: Call) => c.id));
          }
        }
        
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch calls'));
        setIsLoading(false);
      }
    };

    fetchRecentCalls();
  }, [siteId]);

  // Realtime subscription - only after userSites is populated
  useEffect(() => {
    if (userSites.length === 0) {
      return;
    }

    const supabase = createClient();
    const siteIds = siteId ? [siteId] : [...userSites];

    // Runtime assertion: detect duplicate subscriptions
    if (subscriptionRef.current) {
      if (!duplicateWarningRef.current) {
        console.warn('[CALL_ALERT] ⚠️ Duplicate subscription detected! Cleaning up existing subscription before creating new one.');
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
      console.log('[CALL_ALERT] Setting up realtime subscription');
    }

    // Realtime subscription
    const channel = supabase
      .channel('calls-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'calls',
        },
        async (payload) => {
          const newCall = payload.new as Call;
          
          if (isDebugEnabled()) {
            console.log('[CALL_ALERT] 📞 Realtime event received:', {
              callId: newCall.id,
              siteId: newCall.site_id,
              phone: newCall.phone_number,
              matched: newCall.matched_session_id ? 'YES' : 'NO'
            });
          }
          
          // Quick check: if site_id is not in our list, skip (client-side filter)
          if (!siteIds.includes(newCall.site_id)) {
            if (isDebugEnabled()) {
              console.log('[CALL_ALERT] ⏭️ Call from different site, skipping:', newCall.site_id);
            }
            return;
          }
          
          // Trust RLS subscription filter - no redundant verification query (PR3)
          // The subscription already filters by site_id via RLS policies
          // All calls received through the subscription are valid for the user's sites
          const call = newCall as Call;
          
          // Guard against unmount before setState
          if (!isMountedRef.current) {
            if (isDebugEnabled()) {
              console.log('[CALL_ALERT] ⏭️ Component unmounted, skipping call update');
            }
            return;
          }
          
          const isNewCall = !previousCallIdsRef.current.has(call.id);
          
          if (isDebugEnabled() && isNewCall) {
            console.log('[CALL_ALERT] ✅ New call added to feed:', {
              callId: call.id,
              phone: call.phone_number,
              matched: call.matched_session_id ? 'YES' : 'NO'
            });
          }
          
          if (isNewCall && call.matched_session_id) {
            setNewMatchIds(prev => {
              if (!isMountedRef.current) return prev;
              return new Set(prev).add(call.id);
            });
            const timeoutId = setTimeout(() => {
              // Guard against unmount in setTimeout
              if (!isMountedRef.current) return;
              setNewMatchIds(prev => {
                if (!isMountedRef.current) return prev;
                const next = new Set(prev);
                next.delete(call.id);
                return next;
              });
              timeoutRefsRef.current.delete(timeoutId);
            }, 1500);
            timeoutRefsRef.current.add(timeoutId);
          }
          
          // Maintain PR1 deterministic order: prepend new call, keep id DESC tie-breaker
          setCalls((prev) => {
            // Double-check mount status inside setState callback
            if (!isMountedRef.current) return prev;
            const updated = [call, ...prev].slice(0, 20);
            previousCallIdsRef.current = new Set(updated.map(c => c.id));
            return updated;
          });
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[CALL_ALERT] ✅ Realtime subscription ACTIVE for', siteIds.length, 'site(s)');
        } else if (status === 'CHANNEL_ERROR') {
          // Connection errors are often transient - Supabase will auto-reconnect
          console.warn('[CALL_ALERT] ⚠️ Realtime subscription error (will auto-reconnect):', err?.message || 'Connection issue');
        } else if (status === 'CLOSED') {
          console.log('[CALL_ALERT] Realtime subscription closed (normal - will reconnect)');
        } else if (status === 'TIMED_OUT') {
          console.warn('[CALL_ALERT] ⚠️ Realtime subscription timed out');
        } else {
          console.log('[CALL_ALERT] Realtime subscription status:', status);
        }
      });

    subscriptionRef.current = channel;

    return () => {
      // Mark as unmounted before cleanup
      isMountedRef.current = false;
      // Clear all pending timeouts
      timeoutRefsRef.current.forEach(timeoutId => clearTimeout(timeoutId));
      timeoutRefsRef.current.clear();
      if (subscriptionRef.current) {
        if (isDebugEnabled()) {
          console.log('[CALL_ALERT] Cleaning up subscription on unmount');
        }
        supabase.removeChannel(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [userSites, siteId]);

  const handleDismiss = useCallback((id: string) => {
    setDismissed((prev) => new Set(prev).add(id));
  }, []);

  return {
    calls,
    dismissed,
    newMatchIds,
    isLoading,
    error,
    onDismiss: handleDismiss,
  };
}
