'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CallAlertComponent } from './call-alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { isDebugEnabled } from '@/lib/utils';
import { PhoneOff } from 'lucide-react';
import { RealtimeChannel } from '@supabase/supabase-js';

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
  source?: string | null;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
}

interface CallAlertWrapperProps {
  siteId?: string;
}

export function CallAlertWrapper({ siteId }: CallAlertWrapperProps = {}) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [userSites, setUserSites] = useState<string[]>([]);
  const [newMatchIds, setNewMatchIds] = useState<Set<string>>(new Set());
  const previousCallIdsRef = useRef<Set<string>>(new Set());
  const subscriptionRef = useRef<RealtimeChannel | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const timeoutRefsRef = useRef<Set<NodeJS.Timeout>>(new Set());
  const duplicateWarningRef = useRef<boolean>(false);

  useEffect(() => {
    const supabase = createClient();
    isMountedRef.current = true;

    const fetchRecentCalls = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !isMountedRef.current) return;

      if (siteId) {
        const { data: site } = await supabase
          .from('sites')
          .select('id')
          .eq('id', siteId)
          .single();

        if (!site || !isMountedRef.current) return;
        setUserSites([siteId]);

        const { data: recentCalls } = await supabase
          .from('calls')
          .select('*')
          .eq('site_id', siteId)
          .in('status', ['intent', 'confirmed', 'qualified', 'real', null])
          .order('created_at', { ascending: false })
          .limit(20);

        if (recentCalls && isMountedRef.current) {
          setCalls(recentCalls as Call[]);
          previousCallIdsRef.current = new Set(recentCalls.map((c: Call) => c.id));
        }
      } else {
        const { data: sites } = await supabase
          .from('sites')
          .select('id')
          .eq('user_id', user.id);

        if (!sites || sites.length === 0 || !isMountedRef.current) return;
        const sids = sites.map(s => s.id);
        setUserSites(sids);

        const { data: recentCalls } = await supabase
          .from('calls')
          .select('*')
          .in('site_id', sids)
          .in('status', ['intent', 'confirmed', 'qualified', 'real', null])
          .order('created_at', { ascending: false })
          .limit(20);

        if (recentCalls && isMountedRef.current) {
          setCalls(recentCalls as Call[]);
          previousCallIdsRef.current = new Set(recentCalls.map((c: Call) => c.id));
        }
      }
    };

    fetchRecentCalls();
    return () => { isMountedRef.current = false; };
  }, [siteId]);

  useEffect(() => {
    if (userSites.length === 0) return;

    const supabase = createClient();
    const siteIds = siteId ? [siteId] : [...userSites];
    const timeouts = timeoutRefsRef.current;

    if (subscriptionRef.current) {
      if (!duplicateWarningRef.current) {
        console.warn('[CALL_ALERT] Duplicate subscription protection');
        duplicateWarningRef.current = true;
      }
      supabase.removeChannel(subscriptionRef.current);
    }

    const channelName = `calls-realtime-${siteIds.join('-')}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'calls' },
        (payload) => {
          if (!isMountedRef.current) return;
          const newCall = payload.new as Call;
          if (!siteIds.includes(newCall.site_id)) return;

          const isNewCall = !previousCallIdsRef.current.has(newCall.id);

          if (isNewCall && newCall.matched_session_id) {
            setNewMatchIds(prev => new Set(prev).add(newCall.id));
            const tid = setTimeout(() => {
              if (isMountedRef.current) {
                setNewMatchIds(prev => {
                  const next = new Set(prev);
                  next.delete(newCall.id);
                  return next;
                });
              }
              timeouts.delete(tid);
            }, 1500);
            timeouts.add(tid);
          }

          setCalls((prev) => {
            const updated = [newCall, ...prev].slice(0, 20);
            previousCallIdsRef.current = new Set(updated.map(c => c.id));
            return updated;
          });
        }
      )
      .subscribe();

    subscriptionRef.current = channel;

    return () => {
      timeouts.forEach(clearTimeout);
      timeouts.clear();
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [userSites, siteId]);

  const handleDismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const visibleCalls = useMemo(() =>
    calls.filter((call) => !dismissed.has(call.id)),
    [calls, dismissed]
  );

  return (
    <Card className="bg-background text-foreground border border-border shadow-sm">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold tracking-tight">Call Monitor</CardTitle>
            <CardDescription className="text-sm text-muted-foreground mt-1 uppercase tracking-wider">
              Real-time matching
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-sm text-emerald-600">Active</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {visibleCalls.length === 0 ? (
          <div className="text-center py-12 flex flex-col items-center group">
            <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-4 border border-border transition-colors">
              <PhoneOff className="w-5 h-5 text-muted-foreground transition-colors" />
            </div>
            <p className="text-sm text-muted-foreground uppercase tracking-widest mb-1">Waiting for calls…</p>
            <p className="text-sm text-muted-foreground italic">Real-time matching active</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
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
