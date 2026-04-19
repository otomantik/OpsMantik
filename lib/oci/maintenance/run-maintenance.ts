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
 *   1. `sweep-zombies`             → outbox + queue + signals PROCESSING rescue +
 *                                    stale UPLOADED close-out.
 *   2. `recover-stuck-signals`     → re-PENDING marketing_signals stuck > 4h.
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
import { runPulseRecovery } from '@/lib/oci/pulse-recovery-worker';
import { MAX_ATTEMPTS } from '@/lib/domain/oci/queue-types';
import { normalizeCurrencyOrNeutral } from '@/lib/i18n/site-locale';

const SCRIPT_ACK_TIMEOUT_MINUTES = (() => {
  const v = parseInt(process.env.SWEEP_ACK_TIMEOUT_MINUTES ?? '', 10);
  if (Number.isFinite(v) && v >= 5 && v <= 120) return v;
  return 30;
})();

const STUCK_SIGNAL_MIN_AGE_MINUTES = 240;
const STALE_JOB_MIN_AGE_MINUTES = 15;
const ORPHAN_LOOKBACK_DAYS = 7;
const MAX_ORPHANS_PER_RUN = 500;

export interface OciMaintenanceStats {
  outbox_rescued: number;
  queue_rescued: number;
  signals_rescued: number;
  queue_uploaded_closed: number;
  stuck_signals_recovered: number;
  attempt_cap_marked: number;
  orphans_found: number;
  orphans_enqueued: number;
  orphan_skipped_reasons: Record<string, number>;
  pulse_processed: number;
  pulse_recovered: number;
  pulse_exhausted: number;
  stale_jobs_recovered: number;
  errors: string[];
}

function newStats(): OciMaintenanceStats {
  return {
    outbox_rescued: 0,
    queue_rescued: 0,
    signals_rescued: 0,
    queue_uploaded_closed: 0,
    stuck_signals_recovered: 0,
    attempt_cap_marked: 0,
    orphans_found: 0,
    orphans_enqueued: 0,
    orphan_skipped_reasons: {},
    pulse_processed: 0,
    pulse_recovered: 0,
    pulse_exhausted: 0,
    stale_jobs_recovered: 0,
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

    const { data: signals } = await adminClient
      .from('marketing_signals')
      .update({ dispatch_status: 'PENDING', updated_at: new Date().toISOString() })
      .eq('dispatch_status', 'PROCESSING')
      .lt('updated_at', cutoff)
      .select('id');
    stats.signals_rescued = signals?.length ?? 0;

    const { data: closed } = await adminClient.rpc('close_stale_uploaded_conversions', {
      p_min_age_hours: 48,
    });
    stats.queue_uploaded_closed = typeof closed === 'number' ? closed : 0;
  } catch (err) {
    capture(stats, 'sweep_zombies', err);
  }
}

async function step_recoverStuckSignals(stats: OciMaintenanceStats): Promise<void> {
  try {
    const { data, error } = await adminClient.rpc('recover_stuck_marketing_signals', {
      p_min_age_minutes: STUCK_SIGNAL_MIN_AGE_MINUTES,
    });
    if (error) throw new Error(error.message);
    stats.stuck_signals_recovered = typeof data === 'number' ? data : 0;
  } catch (err) {
    capture(stats, 'recover_stuck_signals', err);
  }
}

async function step_attemptCap(stats: OciMaintenanceStats): Promise<void> {
  try {
    const { data, error } = await adminClient.rpc('oci_attempt_cap', {
      p_max_attempts: MAX_ATTEMPTS,
      p_min_age_minutes: 0,
    });
    if (error) throw new Error(error.message);
    stats.attempt_cap_marked = typeof data === 'number' ? data : 0;
    if (stats.attempt_cap_marked > 0) {
      logWarn('OCI_MAINTENANCE_ATTEMPT_CAP_MARKED', { affected: stats.attempt_cap_marked });
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
        .select('id, site_id, confirmed_at, sale_amount, currency, lead_score')
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
      const c = call as { id: string; site_id: string; confirmed_at: string; sale_amount: number | null; currency: string | null; lead_score: number | null };
      const result = await enqueueSealConversion({
        callId: c.id,
        siteId: c.site_id,
        confirmedAt: c.confirmed_at,
        saleAmount: c.sale_amount ?? null,
        currency: normalizeCurrencyOrNeutral(c.currency),
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

async function step_pulseRecovery(stats: OciMaintenanceStats): Promise<void> {
  try {
    const result = await runPulseRecovery();
    stats.pulse_processed = result.processed;
    stats.pulse_recovered = result.recovered;
    stats.pulse_exhausted = result.exhausted;
  } catch (err) {
    capture(stats, 'pulse_recovery', err);
  }
}

async function step_providerRecoverProcessing(stats: OciMaintenanceStats): Promise<void> {
  try {
    const { data, error } = await adminClient.rpc('recover_stuck_offline_conversion_jobs', {
      p_min_age_minutes: STALE_JOB_MIN_AGE_MINUTES,
    });
    if (error) throw new Error(error.message);
    stats.stale_jobs_recovered = typeof data === 'number' ? data : 0;
  } catch (err) {
    capture(stats, 'provider_recover_processing', err);
  }
}

export async function runOciMaintenance(): Promise<OciMaintenanceStats> {
  const stats = newStats();
  const startedAt = Date.now();

  // Order matters: zombie rescue first (so downstream rescues see the up-to-date state),
  // attempt-cap before orphan re-enqueue (so exhausted rows don't get re-enqueued),
  // pulse-recovery last since it is the slowest identity-stitch-heavy step.
  await step_sweepZombies(stats);
  await step_recoverStuckSignals(stats);
  await step_attemptCap(stats);
  await step_providerRecoverProcessing(stats);
  await step_sweepOrphans(stats);
  await step_pulseRecovery(stats);

  logInfo('OCI_MAINTENANCE_COMPLETE', {
    elapsed_ms: Date.now() - startedAt,
    outbox_rescued: stats.outbox_rescued,
    queue_rescued: stats.queue_rescued,
    signals_rescued: stats.signals_rescued,
    queue_uploaded_closed: stats.queue_uploaded_closed,
    stuck_signals_recovered: stats.stuck_signals_recovered,
    attempt_cap_marked: stats.attempt_cap_marked,
    stale_jobs_recovered: stats.stale_jobs_recovered,
    orphans_found: stats.orphans_found,
    orphans_enqueued: stats.orphans_enqueued,
    pulse_processed: stats.pulse_processed,
    pulse_recovered: stats.pulse_recovered,
    pulse_exhausted: stats.pulse_exhausted,
    errors: stats.errors.length,
  });

  return stats;
}
