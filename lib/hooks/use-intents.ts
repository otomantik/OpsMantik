/**
 * Hook for fetching intents (calls + conversion events)
 * 
 * Intents include:
 * - Calls (phone/WhatsApp clicks) with status='intent' or null
 * - Conversion events (event_category='conversion')
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DateRange } from './use-dashboard-date-range';

export type IntentStatus = 'intent' | 'confirmed' | 'qualified' | 'real' | 'junk' | 'suspicious' | null;
export type IntentFilter = 'all' | 'pending' | 'sealed' | 'junk' | 'suspicious';

export interface IntentRow {
  id: string;
  type: 'call' | 'conversion';
  timestamp: string;
  status: IntentStatus;
  sealed_at: string | null;
  page_url: string;
  city: string | null;
  district: string | null;
  device_type: string | null;
  matched_session_id: string | null;
  confidence_score: number; // lead_score for calls, event_value for conversions
  phone_number?: string | null; // For calls
  event_category?: string; // For conversions
  event_action?: string; // For conversions
}

export function useIntents(
  siteId: string | undefined,
  dateRange: DateRange
) {
  const [intents, setIntents] = useState<IntentRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIntents = useCallback(async () => {
    if (!siteId) return;

    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      // Calculate month boundaries for partition filtering
      const startMonth = new Date(dateRange.from.getFullYear(), dateRange.from.getMonth(), 1).toISOString().slice(0, 7) + '-01';
      const endMonth = new Date(dateRange.to.getFullYear(), dateRange.to.getMonth() + 1, 1).toISOString().slice(0, 7) + '-01';

      // Fetch calls (intents)
      const { data: callsData, error: callsError } = await supabase
        .from('calls')
        .select(`
          id,
          created_at,
          status,
          confirmed_at,
          phone_number,
          matched_session_id,
          lead_score,
          sessions!inner(
            site_id,
            city,
            district,
            device_type,
            first_event_url
          )
        `)
        .eq('sessions.site_id', siteId)
        .gte('created_at', dateRange.from.toISOString())
        .lte('created_at', dateRange.to.toISOString())
        .order('created_at', { ascending: false });

      if (callsError) throw callsError;

      // Fetch conversion events
      const { data: conversionsData, error: conversionsError } = await supabase
        .from('events')
        .select(`
          id,
          created_at,
          event_category,
          event_action,
          event_value,
          url,
          session_id,
          session_month,
          sessions!inner(
            site_id,
            city,
            district,
            device_type
          )
        `)
        .eq('sessions.site_id', siteId)
        .eq('event_category', 'conversion')
        .gte('session_month', startMonth)
        .lt('session_month', endMonth)
        .gte('created_at', dateRange.from.toISOString())
        .lte('created_at', dateRange.to.toISOString())
        .order('created_at', { ascending: false });

      if (conversionsError) throw conversionsError;

      // Transform calls to IntentRow
      const callIntents: IntentRow[] = (callsData || []).map(call => ({
        id: call.id,
        type: 'call' as const,
        timestamp: call.created_at,
        status: call.status as IntentStatus,
        sealed_at: call.confirmed_at,
        page_url: (call.sessions as any)?.first_event_url || '',
        city: (call.sessions as any)?.city || null,
        district: (call.sessions as any)?.district || null,
        device_type: (call.sessions as any)?.device_type || null,
        matched_session_id: call.matched_session_id,
        confidence_score: call.lead_score || 0,
        phone_number: call.phone_number,
      }));

      // Transform conversions to IntentRow
      const conversionIntents: IntentRow[] = (conversionsData || []).map(conv => ({
        id: `conv-${conv.id}`,
        type: 'conversion' as const,
        timestamp: conv.created_at,
        status: 'confirmed' as IntentStatus, // Conversions are always confirmed
        sealed_at: conv.created_at,
        page_url: conv.url || '',
        city: (conv.sessions as any)?.city || null,
        district: (conv.sessions as any)?.district || null,
        device_type: (conv.sessions as any)?.device_type || null,
        matched_session_id: conv.session_id,
        confidence_score: conv.event_value || 0,
        event_category: conv.event_category,
        event_action: conv.event_action,
      }));

      // Combine and sort by timestamp
      const allIntents = [...callIntents, ...conversionIntents].sort((a, b) => {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });

      setIntents(allIntents);
    } catch (err: unknown) {
      console.error('[useIntents] Error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch intents';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [siteId, dateRange]);

  useEffect(() => {
    fetchIntents();
  }, [fetchIntents]);

  return { intents, loading, error, refetch: fetchIntents };
}
