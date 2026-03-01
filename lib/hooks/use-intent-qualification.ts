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
import { toast } from 'sonner';
import { useTranslation } from '@/lib/i18n/useTranslation';

export interface QualifyIntentParams {
  /** 0 = junk, 1-100 = lead quality score. */
  score: number;
  status: 'confirmed' | 'junk';
  note?: string;
}

export interface QualifyIntentResult {
  success: boolean;
  error?: string;
}


export function useIntentQualification(
  siteId: string,
  intentId: string,
  matchedSessionId?: string | null,
  onUndoSuccess?: () => void
) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const undoQualification = useCallback(
    async (callId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const response = await fetch(`/api/intents/${callId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'intent',
            lead_score: null,
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || t('toast.error.undoFailed'));
        }

        return { success: true };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : t('toast.error.undoFailed');
        return { success: false, error: errorMessage };
      }
    },
    [t]
  );

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

        const isConfirmed = params.status === 'confirmed';
        const leadScore = params.score; // Passing the actual score directly

        if (isConfirmed) {
          // Route through Seal API so enqueueSealConversion() runs (OCI queue).
          const callIds: string[] = [];
          const doSessionUpdate = Boolean(matchedSessionId && String(matchedSessionId).trim().length > 0);

          if (doSessionUpdate) {
            const { data: rows, error: fetchError } = await supabase
              .from('calls')
              .select('id')
              .eq('site_id', siteId)
              .eq('matched_session_id', matchedSessionId as string)
              .eq('source', 'click')
              .in('status', ['intent', null]);
            if (fetchError) throw fetchError;
            callIds.push(...(rows ?? []).map((r) => r.id));
          } else {
            callIds.push(intentId);
          }

          if (callIds.length === 0) {
            const msg = doSessionUpdate
              ? t('toast.error.sessionAlreadyQualified')
              : t('toast.error.intentAlreadyQualified');
            setError(msg);
            return { success: false, error: msg };
          }

          const body = {
            lead_score: leadScore,
            currency: 'TRY',
          };

          for (const callId of callIds) {
            const res = await fetch(`/api/calls/${callId}/seal`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              credentials: 'include',
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              const msg = (data as { error?: string }).error || (res.status === 404 ? (doSessionUpdate ? t('toast.error.sessionAlreadyQualified') : t('toast.error.intentAlreadyQualified')) : t('toast.error.qualifyFailed'));
              setError(msg);
              return { success: false, error: msg };
            }
          }

          const actionType = 'sealed';
          const undoToastId = toast.success(t('toast.success.done'), {
            description: t('toast.description.intentAction', { action: actionType }),
            duration: 8000,
            action: {
              label: t('common.undo'),
              onClick: async () => {
                toast.dismiss(undoToastId);
                toast.info(t('toast.info.undoing'));
                try {
                  const result = await undoQualification(intentId);
                  if (result.success) {
                    toast.success(t('toast.success.undone'));
                    onUndoSuccess?.();
                  } else {
                    toast.error(t('toast.error.undoFailed'), {
                      description: result.error || t('common.tryAgain'),
                    });
                  }
                } catch (err: unknown) {
                  const errorMessage = err instanceof Error ? err.message : t('toast.error.undoFailed');
                  toast.error(t('toast.error.undoFailed'), { description: errorMessage });
                }
              },
            },
          });
          return { success: true };
        }

        // Junk: direct update (no OCI enqueue).
        const updatePayload = {
          lead_score: leadScore,
          status: 'junk',
          confirmed_at: null,
          confirmed_by: user.id,
          note: params.note || null,
          score_breakdown: {
            manual_score: params.score,
            qualified_by: 'user',
            timestamp: new Date().toISOString(),
          },
          oci_status: 'skipped',
          oci_status_updated_at: new Date().toISOString(),
        };

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
            .in('status', ['intent', null])
            .select('id');

        const { data: updatedRows, error: updateError } = await updateQuery;
        if (updateError) throw updateError;

        const didUpdate = Array.isArray(updatedRows) ? updatedRows.length > 0 : Boolean(updatedRows);
        if (!didUpdate) {
          const msg = doSessionUpdate
            ? t('toast.error.sessionAlreadyQualified')
            : t('toast.error.intentAlreadyQualified');
          setError(msg);
          return { success: false, error: msg };
        }

        const actionType = 'marked as junk';
        toast.success(t('toast.success.done'), {
          description: t('toast.description.intentAction', { action: actionType }),
          duration: 8000,
        });
        return { success: true };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : t('toast.error.qualifyFailed');
        setError(errorMessage);
        toast.error(t('toast.error.failed'));
        return { success: false, error: errorMessage };
      } finally {
        setSaving(false);
      }
    },
    [siteId, intentId, matchedSessionId, undoQualification, onUndoSuccess, t]
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
