/**
 * useSessionData Hook
 * 
 * Extracted from components/dashboard/session-group.tsx for data boundary cleanup.
 * Manages session data fetching and call matching.
 * 
 * Preserves:
 * - PR1: Deterministic ordering (id DESC tie-breaker)
 * - Attribution fallback (session → metadata)
 * - Context chips fallback (session → metadata)
 */

'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface SessionData {
  attribution_source?: string | null;
  device_type?: string | null;
  city?: string | null;
  district?: string | null;
  fingerprint?: string | null;
  gclid?: string | null;
}

export interface MatchedCall {
  id: string;
  phone_number: string;
  matched_session_id: string | null;
  matched_fingerprint?: string | null;
  lead_score: number;
  matched_at?: string | null;
  created_at: string;
  site_id: string;
  status?: string | null;
  source?: string | null;
}

export interface UseSessionDataResult {
  sessionData: SessionData | null;
  matchedCall: MatchedCall | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook for session data fetching and call matching.
 * 
 * @param sessionId - Session ID to fetch data for
 * @param metadata - Event metadata for fallback (optional)
 * @returns Session data and matched call
 */
export function useSessionData(
  sessionId: string,
  metadata?: any
): UseSessionDataResult {
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [matchedCall, setMatchedCall] = useState<MatchedCall | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch session data (normalized fields) - fallback to event metadata
  useEffect(() => {
    const fetchSessionData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const supabase = createClient();
        const { data: session } = await supabase
          .from('sessions')
          .select('attribution_source, device_type, city, district, fingerprint, gclid')
          .eq('id', sessionId)
          .maybeSingle();
        
        if (session) {
          setSessionData(session);
        }
        
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch session data'));
        setIsLoading(false);
      }
    };
    
    fetchSessionData();
  }, [sessionId]);

  // Check for matched call when component mounts or session changes
  useEffect(() => {
    // Use fingerprint from sessionData or metadata
    const currentFingerprint = sessionData?.fingerprint || metadata?.fingerprint || metadata?.fp;
    if (!currentFingerprint) {
      setMatchedCall(null);
      return;
    }

    const supabase = createClient();
    
    // Use JOIN pattern for RLS compliance - calls -> sites -> user_id
    supabase
      .from('calls')
      .select('*, sites!inner(user_id)')
      .eq('matched_fingerprint', currentFingerprint)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }) // PR1: deterministic order
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          // Silently ignore RLS errors (call might belong to another user)
          console.log('[SESSION_GROUP] Call lookup error (RLS?):', error.message);
          setMatchedCall(null);
          return;
        }
        if (data) {
          setMatchedCall(data);
        } else {
          setMatchedCall(null);
        }
      });
  }, [sessionData, metadata]);

  return {
    sessionData,
    matchedCall,
    isLoading,
    error,
  };
}
