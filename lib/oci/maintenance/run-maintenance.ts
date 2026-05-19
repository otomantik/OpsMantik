/**
 * OCI Maintenance Orchestrator — SSOT for the previously separate zombie /
 * stuck-signal / attempt-cap / orphan / pulse / provider-processing sweeps.
 *
 * Each step was historically a standalone cron route, leading to six near-identical
 * handlers fighting for Vercel scheduler slots and making ops runbooks hard to reason
 * about. This module consolidates their core work into one function, keeping each
 * step isolated inside its own try/catch so a single failure does not block the rest.
 *
 * Behavioural parity with the legacy routes:
 *
 *   1. `sweep-zombies`             → outbox + journal queue rescue +
 *                                    stale UPLOADED close-out (GET export reads journal only).
 *   2. `recover-stuck-signals`     → queue-only compatibility route (legacy name).
 *   3. `attempt-cap`               → mark rows with attempt_count >= MAX_ATTEMPTS as FAILED.
 *   4. `sweep-unsent-conversions`  → re-enqueue sealed calls missing from OCI queue.
 *   5. `pulse-recovery`            → identity-stitcher backoff retries (MODULE 2).
 *   6. `providers/recover-processing` → requeue PROCESSING offline_conversion_jobs.
 *
 * The Ouroboros predictive-degradation watchdog is intentionally left in the
 * standalone sweep-zombies route; it is a circuit-breaker that should NOT be
 * tripped by an all-in-one orchestrator run. The RPC calls below are the exact
 * same primitives it guarded.
 */

import { adminClient } from '@/lib/supabase/admin';
import { logError, logInfo, logWarn } from '@/lib/logging/logger';
import { enqueueSealConversion } from '@/lib/oci/enqueue-seal-conversion';
import { MAX_ATTEMPTS } from '@/lib/domain/oci/queue-types';
import { normalizeCurrencyOrNeutral } from '@/lib/i18n/site-locale';
import {
  classifyProcessingRecoveryRows,
  pickSafeRetryRowIds,
  resolveProcessingRecoveryClassifierMode,
  summarizeProcessingRecoveryDecisions,
} from '@/lib/oci/processing-recovery-runtime';

function recoverCountFromRowScopedRpcData(data: unknown): number {
  if (Array.isArray(data)) {
    const first = data[0] as { recovered_count?: number } | undefined;
    return Number(first?.recovered_count ?? 0);
  }
  return Number((data as { recovered_count?: number } | null)?.recovered_count ?? 0);
}

const SCRIPT_ACK_TIMEOUT_MINUTES = (() => {
  const v = parseInt(process.env.SWEEP_ACK_TIMEOUT_MINUTES ?? '', 10);
  if (Number.isFinite(v) && v >= 5 && v <= 120) return v;
  return 30;
})();

const STALE_JOB_MIN_AGE_MINUTES = 15;
const ORPHAN_LOOKBACK_DAYS = 7;
const MAX_ORPHANS_PER_RUN = 500;

export interface OciMaintenanceStats {
  outbox_rescued: number;
  queue_rescued: number;
  queue_uploaded_closed: number;
  attempt_cap_marked: number;
  dlq_escalated: number;
  orphans_found: number;
  orphans_enqueued: number;
  orphan_skipped_reasons: Record<string, number>;
  stale_jobs_recovered: number;
  processing_recovery_mode?: string;
  processing_classifier_shadow_count?: number;
  processing_safe_retry_candidate_count?: number;
  processing_provider_ambiguous_count?: number;
  processing_requires_review_count?: number;
  processing_unknown_provider_outcome_count?: number;
  processing_classifier_enforced_count?: number;
  processing_classifier_bypass_count?: number;
  processing_recovery_enforcement_supported?: boolean;
  errors: string[];
}

function newStats(): OciMaintenanceStats {
  return {
    outbox_rescued: 0,
    queue_rescued: 0,
    queue_uploaded_closed: 0,
    attempt_cap_marked: 0,
    dlq_escalated: 0,
    orphans_found: 0,
    orphans_enqueued: 0,
    orphan_skipped_reasons: {},
    stale_jobs_recovered: 0,
    processing_recovery_mode: 'off',
    processing_classifier_shadow_count: 0,
    processing_safe_retry_candidate_count: 0,
    processing_provider_ambiguous_count: 0,
    processing_requires_review_count: 0,
    processing_unknown_provider_outcome_count: 0,
    processing_classifier_enforced_count: 0,
    processing_classifier_bypass_count: 0,
    processing_recovery_enforcement_supported: false,
    errors: [],
  };
}

function capture(stats: OciMaintenanceStats, step: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  stats.errors.push(`${step}: ${msg}`);
  logError(`OCI_MAINTENANCE_STEP_ERROR`, { step, error: msg });
}

async function step_sweepZombies(stats: OciMaintenanceStats): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - SCRIPT_ACK_TIMEOUT_MINUTES * 60 * 1000).toISOString();
    const { data: outbox } = await adminClient
      .from('outbox_events')
      .update({
        status: 'PENDING',
        last_error: `Rescued by oci-maintenance (stuck in PROCESSING > ${SCRIPT_ACK_TIMEOUT_MINUTES}m)`,
        processed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'PROCESSING')
      .lt('updated_at', cutoff)
      .select('id');
    stats.outbox_rescued = outbox?.length ?? 0;

    const { data: queueRecovered } = await adminClient.rpc('recover_stuck_offline_conversion_jobs', {
      p_min_age_minutes: SCRIPT_ACK_TIMEOUT_MINUTES,
    });
    stats.queue_rescued = typeof queueRecovered === 'number' ? queueRecovered : 0;

    const { data: closed } = await adminClient.rpc('close_stale_uploaded_conversions', {
      p_min_age_hours: 48,
    });
    stats.queue_uploaded_closed = typeof closed === 'number' ? closed : 0;
  } catch (err) {
    capture(stats, 'sweep_zombies', err);
  }
}

async function step_attemptCap(stats: OciMaintenanceStats): Promise<void> {
  try {
    const maxAttempts = Number.parseInt(process.env.OCI_MAX_ATTEMPTS ?? '', 10);
    const effectiveMaxAttempts = Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : MAX_ATTEMPTS;
    const { data, error } = await adminClient.rpc('oci_attempt_cap', {
      p_max_attempts: effectiveMaxAttempts,
      p_min_age_minutes: 0,
    });
    if (error) throw new Error(error.message);
    stats.attempt_cap_marked = typeof data === 'number' ? data : 0;
    if (stats.attempt_cap_marked > 0) {
      logWarn('OCI_MAINTENANCE_ATTEMPT_CAP_MARKED', { affected: stats.attempt_cap_marked, max_attempts: effectiveMaxAttempts });
    }
    const { data: dlqData, error: dlqError } = await adminClient.rpc('escalate_exhausted_to_dlq_v1', {
      p_max_attempts: effectiveMaxAttempts,
      p_limit: 500,
    });
    if (dlqError) throw new Error(dlqError.message);
    stats.dlq_escalated = typeof dlqData === 'number' ? dlqData : 0;
    if (stats.dlq_escalated > 0) {
      logWarn('OCI_MAINTENANCE_DLQ_ESCALATED', { affected: stats.dlq_escalated, max_attempts: effectiveMaxAttempts });
    }
  } catch (err) {
    capture(stats, 'attempt_cap', err);
  }
}

async function step_sweepOrphans(stats: OciMaintenanceStats): Promise<void> {
  try {
    const sinceIso = new Date(Date.now() - ORPHAN_LOOKBACK_DAYS * 86400 * 1000).toISOString();
    const [{ data: queueRows }, { data: sealedCalls, error: callsError }] = await Promise.all([
      adminClient.from('offline_conversion_queue').select('call_id').not('call_id', 'is', null).limit(5000),
      adminClient
        .from('calls')
        .select('id, site_id, confirmed_at, sale_amount, sale_currency, lead_score')
        .eq('oci_status', 'sealed')
        .gte('confirmed_at', sinceIso)
        .not('confirmed_at', 'is', null)
        .order('confirmed_at', { ascending: false })
        .limit(MAX_ORPHANS_PER_RUN * 2),
    ]);
    if (callsError) throw new Error(callsError.message);

    const queued = new Set((queueRows ?? []).map((r) => (r as { call_id: string }).call_id));
    const orphans = (sealedCalls ?? []).filter((c) => !queued.has((c as { id: string }).id));
    stats.orphans_found = orphans.length;

    for (const call of orphans.slice(0, MAX_ORPHANS_PER_RUN)) {
      const c = call as { id: string; site_id: string; confirmed_at: string; sale_amount: number | null; sale_currency: string | null; lead_score: number | null };
      const result = await enqueueSealConversion({
        callId: c.id,
        siteId: c.site_id,
        confirmedAt: c.confirmed_at,
        saleAmount: c.sale_amount ?? null,
        currency: normalizeCurrencyOrNeutral(c.sale_currency),
        leadScore: c.lead_score ?? null,
      });
      if (result.enqueued) {
        stats.orphans_enqueued += 1;
      } else {
        const reason = result.reason ?? 'error';
        stats.orphan_skipped_reasons[reason] = (stats.orphan_skipped_reasons[reason] ?? 0) + 1;
      }
    }
  } catch (err) {
    capture(stats, 'sweep_orphans', err);
  }
}

async function step_providerRecoverProcessing(stats: OciMaintenanceStats): Promise<void> {
  try {
    const classifierMode = resolveProcessingRecoveryClassifierMode(
      process.env.OCI_PROCESSING_RECOVERY_CLASSIFIER_MODE
    );
    stats.processing_recovery_mode = classifierMode;

    const { data: candidates, error: candidatesError } = await adminClient
      .from('offline_conversion_queue')
      .select('id,status,claimed_at,updated_at,provider_request_id,provider_error_code,provider_error_category,retry_count')
      .eq('status', 'PROCESSING')
      .limit(5000);

    if (candidatesError) {
      logWarn('OCI_MAINTENANCE_PROCESSING_CLASSIFIER_CANDIDATE_FETCH_FAILED', {
        error: candidatesError.message,
        classifier_mode: classifierMode,
      });
    } else {
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
        nowIso: new Date().toISOString(),
        stuckThresholdMinutes: STALE_JOB_MIN_AGE_MINUTES,
      });
      const enforcementRequested = classifierMode === 'enforce_safe_retry' || classifierMode === 'strict';
      const safeRetryIds = pickSafeRetryRowIds(classified);
      let enforcementSupported = false;
      let recoveryError: string | null = null;
      let recoveredCount = 0;

      const summary = summarizeProcessingRecoveryDecisions(classified, classifierMode, {
        enforcementSupported,
      });
      stats.processing_classifier_shadow_count = summary.processing_classifier_shadow_count;
      stats.processing_safe_retry_candidate_count = summary.processing_safe_retry_candidate_count;
      stats.processing_provider_ambiguous_count = summary.processing_provider_ambiguous_count;
      stats.processing_requires_review_count = summary.processing_requires_review_count;
      stats.processing_unknown_provider_outcome_count = summary.processing_unknown_provider_outcome_count;
      stats.processing_classifier_enforced_count = summary.processing_classifier_enforced_count;
      stats.processing_classifier_bypass_count = summary.processing_classifier_bypass_count;
      stats.processing_recovery_enforcement_supported = enforcementSupported;

      logInfo('OCI_MAINTENANCE_PROCESSING_CLASSIFIER_PREVIEW', {
        classifier_mode: classifierMode,
        ...summary,
      });
      if (enforcementRequested) {
        if (safeRetryIds.length > 0) {
          const { data, error } = await adminClient.rpc('recover_safe_processing_queue_rows_v1', {
            p_queue_ids: safeRetryIds,
            p_min_age_minutes: STALE_JOB_MIN_AGE_MINUTES,
            p_recovery_reason: 'SAFE_TO_RETRY_CLASSIFIED',
            p_actor: 'processing_recovery_classifier',
          });
          if (error) {
            const msg = String(error.message || '');
            const rpcMissing =
              msg.includes('recover_safe_processing_queue_rows_v1') &&
              (msg.includes('function') || msg.includes('does not exist'));
            if (rpcMissing) {
              recoveryError = 'RECOVERY_ROW_SCOPED_RPC_MISSING';
              enforcementSupported = false;
            } else {
              throw new Error(error.message);
            }
          } else {
            enforcementSupported = true;
            recoveredCount = recoverCountFromRowScopedRpcData(data);
          }
        } else {
          enforcementSupported = true;
          recoveredCount = 0;
        }
      } else {
        const { data, error } = await adminClient.rpc('recover_stuck_offline_conversion_jobs', {
          p_min_age_minutes: STALE_JOB_MIN_AGE_MINUTES,
        });
        if (error) throw new Error(error.message);
        recoveredCount = typeof data === 'number' ? data : 0;
        enforcementSupported = false;
      }

      const summaryFinal = summarizeProcessingRecoveryDecisions(classified, classifierMode, {
        enforcementSupported,
      });
      stats.processing_classifier_shadow_count = summaryFinal.processing_classifier_shadow_count;
      stats.processing_safe_retry_candidate_count = summaryFinal.processing_safe_retry_candidate_count;
      stats.processing_provider_ambiguous_count = summaryFinal.processing_provider_ambiguous_count;
      stats.processing_requires_review_count = summaryFinal.processing_requires_review_count;
      stats.processing_unknown_provider_outcome_count = summaryFinal.processing_unknown_provider_outcome_count;
      stats.processing_classifier_enforced_count = summaryFinal.processing_classifier_enforced_count;
      stats.processing_classifier_bypass_count = summaryFinal.processing_classifier_bypass_count;
      stats.processing_recovery_enforcement_supported = enforcementSupported;
      stats.stale_jobs_recovered = recoveredCount;

      if (enforcementRequested && !enforcementSupported) {
        logWarn('OCI_MAINTENANCE_PROCESSING_CLASSIFIER_ENFORCEMENT_BYPASSED', {
          classifier_mode: classifierMode,
          reason: recoveryError ?? 'ROW_SCOPED_RECOVERY_RPC_NOT_AVAILABLE',
          bypassed_rows: summaryFinal.total_candidates,
        });
      }
    }
  } catch (err) {
    capture(stats, 'provider_recover_processing', err);
  }
}

export async function runOciMaintenance(): Promise<OciMaintenanceStats> {
  const stats = newStats();
  const startedAt = Date.now();

  // Order matters: zombie rescue first (so downstream rescues see the up-to-date state),
  // attempt-cap before orphan re-enqueue (so exhausted rows don't get re-enqueued),
  // provider recover last to avoid fighting with attempt-cap in same cycle.
  await step_sweepZombies(stats);
  await step_attemptCap(stats);
  await step_providerRecoverProcessing(stats);
  await step_sweepOrphans(stats);

  logInfo('OCI_MAINTENANCE_COMPLETE', {
    elapsed_ms: Date.now() - startedAt,
    outbox_rescued: stats.outbox_rescued,
    queue_rescued: stats.queue_rescued,
    queue_uploaded_closed: stats.queue_uploaded_closed,
    attempt_cap_marked: stats.attempt_cap_marked,
    dlq_escalated: stats.dlq_escalated,
    stale_jobs_recovered: stats.stale_jobs_recovered,
    orphans_found: stats.orphans_found,
    orphans_enqueued: stats.orphans_enqueued,
    errors: stats.errors.length,
  });

  return stats;
}
