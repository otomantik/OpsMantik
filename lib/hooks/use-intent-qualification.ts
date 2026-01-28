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
  score: 1 | 2 | 3 | 4 | 5;                    // User-provided score (1-5)
  status: 'confirmed' | 'junk';                // Sealed (confirmed) or Junk
  note?: string;                               // Optional user note
}

export interface QualifyIntentResult {
  success: boolean;
  error?: string;
}

export function useIntentQualification(siteId: string, intentId: string) {
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

        // Convert 1-5 score to 20-100 scale (legacy compatibility)
        const leadScore = params.score * 20;

        // Build update payload
        const updatePayload = {
          lead_score: leadScore,
          status: params.status,
          confirmed_at: new Date().toISOString(),
          confirmed_by: user.id,
          note: params.note || null,
          score_breakdown: {
            manual_score: params.score,
            qualified_by: 'user',
            timestamp: new Date().toISOString(),
          },
        };

        // Atomic update: only if status is still 'intent' (prevent race conditions)
        const { error: updateError, count } = await supabase
          .from('calls')
          .update(updatePayload)
          .eq('id', intentId)
          .eq('site_id', siteId)
          .in('status', ['intent', null]); // Only update if not already qualified

        if (updateError) {
          throw updateError;
        }

        // Check if any rows were updated
        if (count === 0) {
          // Intent was already qualified by another user (race condition)
          setError('This intent was already qualified by another user.');
          setSaving(false);
          return { success: false, error: 'Already qualified' };
        }

        setSaving(false);
        return { success: true };
      } catch (err: any) {
        const errorMessage = err?.message || 'Failed to qualify intent';
        setError(errorMessage);
        setSaving(false);
        return { success: false, error: errorMessage };
      }
    },
    [siteId, intentId]
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
