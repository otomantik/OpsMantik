'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CallAlertComponent } from './call-alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { isDebugEnabled } from '@/lib/utils';

interface Call {
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
  status?: string | null;
}

export function CallAlertWrapper() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [userSites, setUserSites] = useState<string[]>([]);
  const [newMatchIds, setNewMatchIds] = useState<Set<string>>(new Set());
  const previousCallIdsRef = useRef<Set<string>>(new Set());
  const subscriptionRef = useRef<any>(null);
  const isMountedRef = useRef<boolean>(true);
  const timeoutRefsRef = useRef<Set<NodeJS.Timeout>>(new Set());
  const duplicateWarningRef = useRef<boolean>(false);

  useEffect(() => {
    const supabase = createClient();

    // Initial fetch
    const fetchRecentCalls = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: sites } = await supabase
        .from('sites')
        .select('id')
        .eq('user_id', user.id);

      if (!sites || sites.length === 0) return;

      const siteIds = sites.map(s => s.id);
      setUserSites(siteIds);

      const { data: recentCalls } = await supabase
        .from('calls')
        .select('*')
        .in('site_id', siteIds)
        .order('created_at', { ascending: false })
        .limit(10);

      if (recentCalls) {
        setCalls(recentCalls as Call[]);
        previousCallIdsRef.current = new Set(recentCalls.map(c => c.id));
      }
    };

    fetchRecentCalls();
  }, []);

  // Realtime subscription - only after userSites is populated
  useEffect(() => {
    if (userSites.length === 0) {
      return;
    }

    const supabase = createClient();
    const siteIds = [...userSites];

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
          
          // Quick check: if site_id is not in our list, skip verification
          if (!siteIds.includes(newCall.site_id)) {
            if (isDebugEnabled()) {
              console.log('[CALL_ALERT] ⏭️ Call from different site, skipping:', newCall.site_id);
            }
            return;
          }
          
          // Verify call belongs to user's sites (RLS check)
          const { data: verifiedCall, error } = await supabase
            .from('calls')
            .select('*')
            .eq('id', newCall.id)
            .single();
          
          if (error) {
            console.warn('[CALL_ALERT] ⚠️ Verification failed (RLS block?):', {
              error: error.message,
              callId: newCall.id,
              siteId: newCall.site_id
            });
            return;
          }
          
          if (verifiedCall) {
            const call = verifiedCall as Call;
            
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
            
            setCalls((prev) => {
              // Double-check mount status inside setState callback
              if (!isMountedRef.current) return prev;
              const updated = [call, ...prev].slice(0, 10);
              previousCallIdsRef.current = new Set(updated.map(c => c.id));
              return updated;
            });
          }
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
  }, [userSites]);

  const handleDismiss = useCallback((id: string) => {
    setDismissed((prev) => new Set(prev).add(id));
  }, []);

  const visibleCalls = useMemo(() => 
    calls.filter((call) => !dismissed.has(call.id)), 
    [calls, dismissed]
  );

  return (
    <Card className="glass border-slate-800/50 shadow-2xl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-mono text-slate-200">CALL MONITOR</CardTitle>
            <CardDescription className="font-mono text-xs text-slate-400 mt-1">
              Live phone matches
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
            <span className="text-xs font-mono text-emerald-400">ACTIVE</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {visibleCalls.length === 0 ? (
          <div className="text-center py-8">
            <p className="font-mono text-sm text-slate-500">No calls detected</p>
            <p className="font-mono text-xs text-slate-600 mt-2">Awaiting activity...</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {visibleCalls.map((call) => (
              <CallAlertComponent
                key={call.id}
                call={call}
                onDismiss={handleDismiss}
                isNewMatch={newMatchIds.has(call.id)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
