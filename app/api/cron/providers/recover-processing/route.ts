/**
 * @deprecated CUT-02D — Unscheduled (break-glass). See docs/architecture/SEAL/CRON_CONTRACT.md.
 * Replacement: `/api/cron/oci-maintenance`
 */
/**
 * GET/POST /api/cron/providers/recover-processing — requeue jobs stuck in PROCESSING (e.g. worker crash).
 * Auth: requireCronAuth. Query: min_age_minutes=15 (default).
 * Vercel Cron sends GET; POST kept for manual/Bearer calls.
 * Distributed lock prevents overlapping runs (Redis SET NX EX).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { tryAcquireCronLock, releaseCronLock } from '@/lib/cron/with-cron-lock';
import { logInfo, logWarn } from '@/lib/logging/logger';
import {
  classifyProcessingRecoveryRows,
  pickSafeRetryRowIds,
  resolveProcessingRecoveryClassifierMode,
  summarizeProcessingRecoveryDecisions,
} from '@/lib/oci/processing-recovery-runtime';
import { adminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const DEFAULT_MIN_AGE_MINUTES = 15; // Stale job recovery: reset PROCESSING → RETRY after 15 min (worker crash)
const CRON_LOCK_TTL_SEC = 660; // 11 min — exceeds 10-min schedule to prevent overlap

function recoverCountFromRowScopedRpcData(data: unknown): number {
  if (Array.isArray(data)) {
    const first = data[0] as { recovered_count?: number } | undefined;
    return Number(first?.recovered_count ?? 0);
  }
  return Number((data as { recovered_count?: number } | null)?.recovered_count ?? 0);
}

async function runRecover(req: NextRequest) {
  const minAge = Math.max(
    1,
    Math.min(
      60,
      parseInt(req.nextUrl.searchParams.get('min_age_minutes') ?? String(DEFAULT_MIN_AGE_MINUTES), 10) || DEFAULT_MIN_AGE_MINUTES
    )
  );
  const classifierMode = resolveProcessingRecoveryClassifierMode(
    process.env.OCI_PROCESSING_RECOVERY_CLASSIFIER_MODE
  );

  const nowIso = new Date().toISOString();
  const { data: candidates, error: candidatesError } = await adminClient
    .from('offline_conversion_queue')
    .select('id,status,claimed_at,updated_at,provider_request_id,provider_error_code,provider_error_category,retry_count')
    .eq('status', 'PROCESSING')
    .limit(5000);

  const classified = classifyProcessingRecoveryRows({
    rows: (candidates ?? []) as Array<{
      id: string;
      status: string;
      claimed_at?: string | null;
      updated_at?: string | null;
      provider_request_id?: string | null;
      provider_error_code?: string | null;
      provider_error_category?: string | null;
      retry_count?: number | null;
    }>,
    nowIso,
    stuckThresholdMinutes: minAge,
  });
  const enforcementRequested = classifierMode === 'enforce_safe_retry' || classifierMode === 'strict';
  const safeRetryIds = pickSafeRetryRowIds(classified);
  let enforcementSupported = false;
  let recovered = 0;
  let recoveryError: string | null = null;

  const classification = summarizeProcessingRecoveryDecisions(classified, classifierMode, {
    enforcementSupported,
  });

  if (candidatesError) {
    logWarn('RECOVER_PROCESSING_CLASSIFIER_CANDIDATE_FETCH_FAILED', { error: candidatesError.message, classifier_mode: classifierMode });
  } else {
    logInfo('RECOVER_PROCESSING_CLASSIFIER_PREVIEW', {
      classifier_mode: classifierMode,
      ...classification,
    });
  }

  if (enforcementRequested) {
    if (safeRetryIds.length > 0) {
      const { data, error } = await adminClient.rpc('recover_safe_processing_queue_rows_v1', {
        p_queue_ids: safeRetryIds,
        p_min_age_minutes: minAge,
        p_recovery_reason: 'SAFE_TO_RETRY_CLASSIFIED',
        p_actor: 'processing_recovery_classifier',
      });
      if (error) {
        const errorText = String(error.message || '');
        const rpcMissing =
          errorText.includes('recover_safe_processing_queue_rows_v1') &&
          (errorText.includes('function') || errorText.includes('does not exist'));
        if (rpcMissing) {
          recoveryError = 'RECOVERY_ROW_SCOPED_RPC_MISSING';
          enforcementSupported = false;
          logWarn('RECOVER_PROCESSING_ROW_SCOPED_RPC_MISSING', {
            classifier_mode: classifierMode,
            safe_retry_ids: safeRetryIds.length,
          });
        } else {
          return NextResponse.json(
            { ok: false, error: error.message },
            { status: 500, headers: getBuildInfoHeaders() }
          );
        }
      } else {
        enforcementSupported = true;
        recovered = recoverCountFromRowScopedRpcData(data);
      }
    } else {
      enforcementSupported = true;
      recovered = 0;
    }
  } else {
    const { data, error } = await adminClient.rpc('recover_stuck_offline_conversion_jobs', {
      p_min_age_minutes: minAge,
    });
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }
    recovered = (data as number) ?? 0;
    enforcementSupported = false;
  }
  const classificationFinal = summarizeProcessingRecoveryDecisions(classified, classifierMode, {
    enforcementSupported,
  });
  if (enforcementRequested && !enforcementSupported) {
    logWarn('RECOVER_PROCESSING_CLASSIFIER_ENFORCEMENT_BYPASSED', {
      classifier_mode: classifierMode,
      reason: recoveryError ?? 'ROW_SCOPED_RECOVERY_RPC_NOT_AVAILABLE',
      bypassed_rows: classificationFinal.total_candidates,
    });
  }
  if (recovered > 0) {
    logWarn('RECOVER_PROCESSING_STALE_JOBS', {
      recovered,
      classifier_mode: classifierMode,
      enforcement_supported: enforcementSupported,
    });
  }
  return NextResponse.json(
    {
      ok: true,
      recovered,
      processing_recovery_mode: classifierMode,
      processing_recovery_enforcement_supported: enforcementSupported,
      processing_classifier_summary: classificationFinal,
      ...(recoveryError ? { processing_recovery_error: recoveryError } : {}),
      processing_recovery_integrity:
        classifierMode === 'off' || classifierMode === 'shadow'
          ? 'RECOVERY_INTEGRITY_UNVERIFIED'
          : enforcementSupported
            ? 'RECOVERY_INTEGRITY_PARTIAL'
            : 'RECOVERY_INTEGRITY_RED',
    },
    { status: 200, headers: getBuildInfoHeaders() }
  );
}

async function handlerWithLock(req: NextRequest) {
  const acquired = await tryAcquireCronLock('providers/recover-processing', CRON_LOCK_TTL_SEC);
  if (!acquired) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  }
  try {
    return await runRecover(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  } finally {
    await releaseCronLock('providers/recover-processing');
  }
}

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return handlerWithLock(req);
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return handlerWithLock(req);
}
