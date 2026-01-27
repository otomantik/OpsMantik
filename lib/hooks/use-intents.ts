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

      // Use RPC function for server-side aggregation (v2.2 contract)
      const { data: intentsData, error: rpcError } = await supabase.rpc('get_dashboard_intents', {
        p_site_id: siteId,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_status: null,
        p_search: null,
        // ADS Command Center: enforce Ads-only server-side filter
        p_ads_only: true,
      });

      if (rpcError) throw rpcError;

      // FIX 2: Transform RPC response to IntentRow[] with defensive parsing
      if (intentsData && Array.isArray(intentsData)) {
        const transformed = intentsData.map((intent: any) => ({
          id: typeof intent.id === 'string' ? intent.id : '',
          type: (intent.type === 'call' || intent.type === 'conversion') ? intent.type : 'call',
          timestamp: typeof intent.timestamp === 'string' ? intent.timestamp : new Date().toISOString(),
          status: intent.status as IntentStatus,
          sealed_at: typeof intent.sealed_at === 'string' ? intent.sealed_at : null,
          page_url: typeof intent.page_url === 'string' ? intent.page_url : '',
          city: typeof intent.city === 'string' ? intent.city : null,
          district: typeof intent.district === 'string' ? intent.district : null,
          device_type: typeof intent.device_type === 'string' ? intent.device_type : null,
          matched_session_id: typeof intent.matched_session_id === 'string' ? intent.matched_session_id : null,
          confidence_score: typeof intent.confidence_score === 'number' ? intent.confidence_score : 0,
          phone_number: typeof intent.phone_number === 'string' ? intent.phone_number : null,
          event_category: typeof intent.event_category === 'string' ? intent.event_category : undefined,
          event_action: typeof intent.event_action === 'string' ? intent.event_action : undefined,
        }));
        setIntents(transformed);
      } else {
        setIntents([]);
      }
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
