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

export type IntentStatus = 'intent' | 'confirmed' | 'qualified' | 'real' | 'junk' | 'suspicious' | 'cancelled' | null;
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
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  dedupe_key?: string | null;
  duplicate_hint?: boolean;
}

export function useIntents(
  siteId: string | undefined,
  dateRange: DateRange,
  opts?: { adsOnly?: boolean; onlyUnreviewed?: boolean; includeReviewed?: boolean; sourceSurface?: string }
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
      let intentsData: unknown = null;
      let rpcError: { message?: string } | null = null;
      const modern = await supabase.rpc('get_dashboard_intents', {
        p_site_id: siteId,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_status: null,
        p_search: null,
        p_ads_only: opts?.adsOnly ?? true,
        p_only_unreviewed: opts?.onlyUnreviewed ?? true,
        p_include_reviewed: opts?.includeReviewed ?? false,
      });
      intentsData = modern.data;
      rpcError = modern.error;
      const msg = String(rpcError?.message || '').toLowerCase();
      if (rpcError && (msg.includes('does not exist') || msg.includes('not found') || msg.includes('function'))) {
        const legacy = await supabase.rpc('get_dashboard_intents', {
          p_site_id: siteId,
          p_date_from: dateRange.from.toISOString(),
          p_date_to: dateRange.to.toISOString(),
          p_status: null,
          p_search: null,
          p_ads_only: opts?.adsOnly ?? true,
        });
        intentsData = legacy.data;
        rpcError = legacy.error;
      }
      if (rpcError) throw rpcError;

      // FIX 2: Transform RPC response to IntentRow[] with defensive parsing
      if (intentsData && Array.isArray(intentsData)) {
        type RpcIntentItem = Record<string, unknown> & { id?: unknown; type?: unknown; timestamp?: unknown; status?: unknown; sealed_at?: unknown; page_url?: unknown; city?: unknown; district?: unknown; device_type?: unknown; matched_session_id?: unknown; confidence_score?: unknown; phone_number?: unknown; event_category?: unknown; event_action?: unknown };
        const transformed: IntentRow[] = intentsData.map((intent: RpcIntentItem) => ({
          id: typeof intent.id === 'string' ? intent.id : '',
          type: (intent.type === 'call' || intent.type === 'conversion') ? intent.type : 'call',
          timestamp: typeof intent.timestamp === 'string' ? intent.timestamp : new Date().toISOString(),
          status: (intent.status as IntentStatus) ?? null,
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
          reviewed_at: typeof intent.reviewed_at === 'string' ? intent.reviewed_at : null,
          reviewed_by: typeof intent.reviewed_by === 'string' ? intent.reviewed_by : null,
          dedupe_key:
            typeof intent.dedupe_key === 'string'
              ? intent.dedupe_key
              : typeof intent.canonical_intent_key === 'string'
                ? intent.canonical_intent_key
                : null,
          duplicate_hint: intent.duplicate_hint === true,
        }));
        if (process.env.NODE_ENV !== 'production') {
          const dupes = transformed.filter((x) => x.duplicate_hint || x.dedupe_key == null).length;
          console.info('[intent-forensics] intent_load', {
            site_id: siteId,
            source_surface: opts?.sourceSurface || 'use-intents',
            query_params_snapshot: {
              from: dateRange.from.toISOString(),
              to: dateRange.to.toISOString(),
              ads_only: opts?.adsOnly ?? true,
              only_unreviewed: opts?.onlyUnreviewed ?? true,
              include_reviewed: opts?.includeReviewed ?? false,
            },
            loaded: transformed.length,
            duplicate_hint_count: transformed.filter((x) => x.duplicate_hint).length,
            missing_dedupe_key_count: transformed.filter((x) => !x.dedupe_key).length,
            sample: transformed.slice(0, 3).map((x) => ({
              intent_id: x.id,
              matched_session_id: x.matched_session_id,
              status: x.status,
              reviewed_at: x.reviewed_at ?? null,
              dedupe_key: x.dedupe_key ?? null,
            })),
            anomalies: dupes,
          });
        }
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
  }, [siteId, dateRange, opts?.adsOnly, opts?.onlyUnreviewed, opts?.includeReviewed, opts?.sourceSurface]);

  useEffect(() => {
    fetchIntents();
  }, [fetchIntents]);

  return { intents, loading, error, refetch: fetchIntents };
}
