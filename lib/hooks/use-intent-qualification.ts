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
import { parseMutationError } from '@/lib/queue/mutation-error';
import { logger } from '@/lib/logging/logger';

export interface QualifyIntentParams {
  /** 0 = junk, 1-100 = lead quality score. */
  score: number;
  status: 'confirmed' | 'junk';
  note?: string;
  /** `calls.version` for seal / RPC optimistic locking; omit to use hook `intentRowVersion` or server-resolved `0`. */
  version?: number | null;
}

export interface QualifyIntentResult {
  success: boolean;
  error?: string;
}


export function useIntentQualification(
  siteId: string,
  intentId: string,
  matchedSessionId?: string | null,
  onUndoSuccess?: () => void,
  /** Current `calls.version` for the active intent row (from queue RPC). */
  intentRowVersion?: number | null
) {
  const { t, tUnsafe } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const undoQualification = useCallback(
    async (callId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const response = await fetch(`/api/intents/${callId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            status: 'intent',
            lead_score: null,
          }),
        });

        if (!response.ok) {
          const dataUnknown = await response.json().catch(() => ({}));
          const data = dataUnknown as { error?: string };
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
          // P0 symmetry hardening: one UI qualification action only mutates the clicked call,
          // so Undo can deterministically revert the exact same call.
          void matchedSessionId;
          const callIds = [intentId];

          const v =
            typeof params.version === 'number' && Number.isFinite(params.version)
              ? params.version
              : typeof intentRowVersion === 'number' && Number.isFinite(intentRowVersion)
                ? intentRowVersion
                : 0;
          const body = {
            lead_score: leadScore,
            version: v,
          };

          for (const callId of callIds) {
            const res = await fetch(`/api/calls/${callId}/seal`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              credentials: 'include',
            });
            if (!res.ok) {
              const parsed = await parseMutationError(res, tUnsafe);
              if (parsed.telemetry) {
                logger.warn(parsed.telemetry, { site_id: siteId, call_id: callId, status: parsed.status, code: parsed.code });
              }
              const msg =
                parsed.message ||
                (res.status === 404 ? t('toast.error.intentAlreadyQualified') : t('toast.error.qualifyFailed'));
              setError(msg);
              return { success: false, error: msg };
            }
          }

          const actionType = leadScore === 100
            ? 'sealed'
            : leadScore === 80
              ? t('hunter.offered').toLowerCase()
              : t('hunter.contacted').toLowerCase();
          const undoToastId = toast.success(
            leadScore === 100 ? t('toast.success.done') : actionType.toUpperCase(),
            {
              description: leadScore === 100
                ? t('toast.description.intentAction', { action: 'sealed' })
                : t('toast.description.intentAction', { action: actionType }),
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

        // Junk: Route through Status API (server uses adminClient so write always persists)
        const v =
          typeof params.version === 'number' && Number.isFinite(params.version)
            ? params.version
            : typeof intentRowVersion === 'number' && Number.isFinite(intentRowVersion)
              ? intentRowVersion
              : 0;

        const res = await fetch(`/api/intents/${intentId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            status: 'junk',
            lead_score: leadScore,
            version: v,
          }),
        });

        if (!res.ok) {
          const parsed = await parseMutationError(res, tUnsafe);
          if (parsed.telemetry) {
            logger.warn(parsed.telemetry, { site_id: siteId, call_id: intentId, status: parsed.status, code: parsed.code });
          }
          const msg = parsed.message || t('toast.error.qualifyFailed');
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
    [siteId, intentId, matchedSessionId, undoQualification, onUndoSuccess, t, tUnsafe, intentRowVersion]
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
