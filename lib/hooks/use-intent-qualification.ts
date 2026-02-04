/**
 * useIntentQualification Hook
 * 
 * Handles manual qualification of intents by users.
 * Updates: lead_score, status, confirmed_at, confirmed_by, note
 * 
 * Usage:
 * const { qualify, saving, error } = useIntentQualification(siteId, intentId);
 * await qualify({ score: 4, status: 'confirmed', note: 'Real customer' });
 */

'use client';

import { useCallback, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface QualifyIntentParams {
  /** 0 = junk, 1-5 = lead quality (Lazy Antiques Dealer). */
  score: 0 | 1 | 2 | 3 | 4 | 5;
  status: 'confirmed' | 'junk';
  note?: string;
}

export interface QualifyIntentResult {
  success: boolean;
  error?: string;
}

export function useIntentQualification(siteId: string, intentId: string, matchedSessionId?: string | null) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qualify = useCallback(
    async (params: QualifyIntentParams): Promise<QualifyIntentResult> => {
      setSaving(true);
      setError(null);

      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          throw new Error('User not authenticated');
        }

        // Convert 0-5 score to 0-100 scale (0 = junk, 1-5 = 20-100)
        const leadScore = params.score * 20;

        const isConfirmed = params.status === 'confirmed';
        const updatePayload = {
          lead_score: leadScore,
          status: params.status,
          confirmed_at: isConfirmed ? new Date().toISOString() : null,
          confirmed_by: user.id,
          note: params.note || null,
          score_breakdown: {
            manual_score: params.score,
            qualified_by: 'user',
            timestamp: new Date().toISOString(),
          },
          oci_status: isConfirmed ? 'sealed' : 'skipped',
          oci_status_updated_at: new Date().toISOString(),
        };

        // Session-based single card:
        // If we have matched_session_id, qualify ALL pending click-intents in that session.
        // This ensures legacy duplicates can't remain visible and the queue stays "1 person = 1 card".
        const doSessionUpdate = Boolean(matchedSessionId && String(matchedSessionId).trim().length > 0);

        const updateQuery = doSessionUpdate
          ? supabase
              .from('calls')
              .update(updatePayload)
              .eq('site_id', siteId)
              .eq('matched_session_id', matchedSessionId as string)
              .eq('source', 'click')
              .in('status', ['intent', null])
              .select('id')
          : supabase
              .from('calls')
              .update(updatePayload)
              .eq('id', intentId)
              .eq('site_id', siteId)
              .in('status', ['intent', null]) // Only update if not already qualified
              .select('id');

        const { data: updatedRows, error: updateError } = await updateQuery;

        if (updateError) {
          throw updateError;
        }

        // If 0 rows matched, PostgREST returns empty data when we request a select.
        // Without this check, the UI can show "success" while nothing changed in DB.
        // Note: some older supabase-js versions return null data without a select; keep this defensive.
        const didUpdate =
          Array.isArray(updatedRows) ? updatedRows.length > 0 : Boolean(updatedRows);
        if (!didUpdate) {
          const msg = doSessionUpdate
            ? 'This session was already qualified (or no longer pending).'
            : 'This intent was already qualified (or no longer pending).';
          setError(msg);
          return { success: false, error: msg };
        }

        return { success: true };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to qualify intent';
        setError(errorMessage);
        return { success: false, error: errorMessage };
      } finally {
        setSaving(false);
      }
    },
    [siteId, intentId, matchedSessionId]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    qualify,
    saving,
    error,
    clearError,
  };
}
