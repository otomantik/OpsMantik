/**
 * useVisitorHistory Hook
 * 
 * Fetches visitor session history by fingerprint for a given site.
 * Used to show returning visitor badge and visitor history drawer.
 * 
 * Preserves:
 * - PR1: Deterministic ordering (created_at DESC, id DESC)
 * - RLS compliance (site_id filter)
 */

'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface VisitorSession {
  id: string;
  created_at: string;
  attribution_source: string | null;
  device_type: string | null;
  city: string | null;
  lead_score?: number | null;
}

export interface VisitorCall {
  id: string;
  phone_number: string;
  matched_session_id: string | null;
  created_at: string;
  lead_score: number;
  status: string | null;
}

export interface UseVisitorHistoryResult {
  sessions: VisitorSession[];
  calls: VisitorCall[];
  sessionCount24h: number;
  isReturning: boolean;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook for fetching visitor session history by fingerprint.
 * 
 * @param siteId - Site ID to filter by (RLS enforces access)
 * @param fingerprint - Fingerprint to search for
 * @returns Visitor session history and returning visitor status
 */
export function useVisitorHistory(
  siteId: string,
  fingerprint: string | null
): UseVisitorHistoryResult {
  const [sessions, setSessions] = useState<VisitorSession[]>([]);
  const [calls, setCalls] = useState<VisitorCall[]>([]);
  const [sessionCount24h, setSessionCount24h] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!siteId || !fingerprint) {
      setSessions([]);
      setCalls([]);
      setSessionCount24h(0);
      setIsLoading(false);
      return;
    }

    const fetchVisitorHistory = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const supabase = createClient();
        
        // Fetch sessions for this fingerprint within site (RLS compliant)
        // PR1: Deterministic order (created_at DESC, id DESC)
        const { data: allSessions, error: sessionsError } = await supabase
          .from('sessions')
          .select('id, created_at, attribution_source, device_type, city, lead_score')
          .eq('site_id', siteId)
          .eq('fingerprint', fingerprint)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(20);

        if (sessionsError) {
          throw sessionsError;
        }

        if (!allSessions) {
          setSessions([]);
          setCalls([]);
          setSessionCount24h(0);
          setIsLoading(false);
          return;
        }

        // Calculate 24 hours ago for counting
        const twentyFourHoursAgo = new Date();
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
        
        // Count sessions in last 24 hours
        const sessions24h = allSessions.filter(
          (s) => new Date(s.created_at) >= twentyFourHoursAgo
        );
        const count24h = sessions24h.length;

        // Map to VisitorSession format
        const sessionsWithCounts: VisitorSession[] = allSessions.map((session) => ({
          id: session.id,
          created_at: session.created_at,
          attribution_source: session.attribution_source,
          device_type: session.device_type,
          city: session.city,
          lead_score: session.lead_score || null,
        }));

        // Fetch calls with same fingerprint but different matched_session_id
        // Filter out calls already matched to fetched sessions
        const sessionIds = new Set(allSessions.map(s => s.id));
        const { data: fingerprintCalls } = await supabase
          .from('calls')
          .select('id, phone_number, matched_session_id, created_at, lead_score, status')
          .eq('matched_fingerprint', fingerprint)
          .eq('site_id', siteId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(20);

        const otherCalls: VisitorCall[] = (fingerprintCalls || [])
          .filter(c => !c.matched_session_id || !sessionIds.has(c.matched_session_id))
          .map(c => ({
            id: c.id,
            phone_number: c.phone_number,
            matched_session_id: c.matched_session_id,
            created_at: c.created_at,
            lead_score: c.lead_score,
            status: c.status
          }));

        setSessions(sessionsWithCounts);
        setCalls(otherCalls);
        setSessionCount24h(count24h);
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch visitor history'));
        setIsLoading(false);
      }
    };

    fetchVisitorHistory();
  }, [siteId, fingerprint]);

  // Returning visitor: >=2 sessions in last 24 hours
  const isReturning = sessionCount24h >= 2;

  return {
    sessions,
    calls,
    sessionCount24h,
    isReturning,
    isLoading,
    error,
  };
}
