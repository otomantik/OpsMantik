/**
 * GET/POST /api/cron/night-maintenance — Serial night storage hygiene (PR-D1).
 * Runs idempotency → outbox → GDPR → processed_signals → marketing_signals retention → truth_evidence under one lock.
 * Mutations require ?apply=true and OPSMANTIK_STORAGE_CLEANUP_APPROVAL.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { recordCronHeartbeat } from '@/lib/cron/heartbeat';
import { tryAcquireCronLock, releaseCronLock, startCronLockHeartbeat } from '@/lib/cron/with-cron-lock';
import { logError, logInfo } from '@/lib/logging/logger';
import {
  assessLimitHit,
  logLimitHitAssessment,
  parseRpcAffected,
  parseStorageCleanupParams,
} from '@/lib/storage/cleanup-kernel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LOCK_KEY = 'night-maintenance';
const LOCK_TTL_SEC = 7200;
const IDEM_BATCH = 10_000;
const IDEM_MAX_LOOPS = 3;

async function runNightMaintenance(req: NextRequest) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const params = parseStorageCleanupParams(req, { batchLimit: 5000, days: 90 });
  const dryRun = params.dryRun;

  await recordCronHeartbeat({
    jobName: 'night-maintenance',
    routePath: '/api/cron/night-maintenance',
    status: 'RUNNING',
    startedAt,
  });

  const acquired = await tryAcquireCronLock(LOCK_KEY, LOCK_TTL_SEC);
  if (!acquired) {
    await recordCronHeartbeat({
      jobName: 'night-maintenance',
      routePath: '/api/cron/night-maintenance',
      status: 'PARTIAL',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      errorCode: 'LOCK_HELD',
      errorMessage: 'Skipped due to active lock',
    });
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { headers: getBuildInfoHeaders() }
    );
  }

  const stopHeartbeat = startCronLockHeartbeat(LOCK_KEY, LOCK_TTL_SEC);
  const phases: Record<string, unknown> = {};
  let partial = false;
  let totalRows = 0;

  try {
    const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const cutoffIso = cutoffDate.toISOString();

    let idemDeleted = 0;
    if (dryRun) {
      const { count } = await adminClient
        .from('ingest_idempotency')
        .select('*', { count: 'exact', head: true })
        .lt('created_at', cutoffIso);
      idemDeleted = count ?? 0;
      phases.idempotency = { would_delete: idemDeleted, dry_run: true };
    } else {
      for (let i = 0; i < IDEM_MAX_LOOPS; i++) {
        const { data, error } = await adminClient.rpc('delete_expired_idempotency_batch', {
          p_cutoff_iso: cutoffIso,
          p_batch_size: IDEM_BATCH,
        });
        if (error) throw new Error(`idempotency: ${error.message}`);
        const n = typeof data === 'number' ? data : 0;
        idemDeleted += n;
        if (n < IDEM_BATCH) break;
        partial = true;
      }
      phases.idempotency = { deleted: idemDeleted };
      totalRows += idemDeleted;
      logLimitHitAssessment(
        'night-maintenance-idempotency',
        assessLimitHit(idemDeleted, IDEM_BATCH)
      );
    }

    const { data: outboxData, error: outboxErr } = await adminClient.rpc('delete_outbox_processed_batch', {
      p_days_old: 7,
      p_limit: params.batchLimit,
      p_dry_run: dryRun,
    });
    if (outboxErr) throw new Error(`outbox: ${outboxErr.message}`);
    const outboxAffected = parseRpcAffected(outboxData);
    phases.outbox = outboxData;
    totalRows += outboxAffected;
    logLimitHitAssessment('night-maintenance-outbox', assessLimitHit(outboxAffected, params.batchLimit));

    const { data: gdprData, error: gdprErr } = await adminClient.rpc('anonymize_consent_less_data_batch', {
      p_days: params.days ?? 90,
      p_limit: params.batchLimit,
      p_dry_run: dryRun,
    });
    if (gdprErr) throw new Error(`gdpr: ${gdprErr.message}`);
    phases.gdpr = gdprData;
    if (gdprData && typeof gdprData === 'object') {
      const g = gdprData as { sessions_affected?: number; events_affected?: number };
      totalRows += Number(g.sessions_affected ?? 0) + Number(g.events_affected ?? 0);
    }

    const { data: staleData, error: staleErr } = await adminClient.rpc('fail_stale_processed_signals_batch', {
      p_age_minutes: 31,
      p_limit: params.batchLimit,
      p_dry_run: dryRun,
    });
    if (staleErr) throw new Error(`processed_signals_stale: ${staleErr.message}`);
    const staleAffected = parseRpcAffected(staleData);
    phases.processed_signals_stale = staleData;
    totalRows += staleAffected;

    const { data: dedupData, error: dedupErr } = await adminClient.rpc('delete_processed_signals_batch', {
      p_days_old: 90,
      p_limit: params.batchLimit,
      p_dry_run: dryRun,
    });
    if (dedupErr) throw new Error(`processed_signals_delete: ${dedupErr.message}`);
    const dedupAffected = parseRpcAffected(dedupData);
    phases.processed_signals_delete = dedupData;
    totalRows += dedupAffected;

    if (dedupAffected >= params.batchLimit || staleAffected >= params.batchLimit) {
      partial = true;
    }

    const { data: msData, error: msErr } = await adminClient.rpc('cleanup_marketing_signals_batch', {
      p_days_old: 60,
      p_limit: params.batchLimit,
      p_dry_run: dryRun,
    });
    if (msErr) throw new Error(`marketing_signals_retention: ${msErr.message}`);
    const msAffected = parseRpcAffected(msData);
    phases.marketing_signals_retention = msData;
    totalRows += msAffected;
    logLimitHitAssessment('night-maintenance-marketing-signals', assessLimitHit(msAffected, params.batchLimit));

    const { data: truthData, error: truthErr } = await adminClient.rpc('delete_truth_evidence_batch', {
      p_days_old: 90,
      p_limit: params.batchLimit,
      p_dry_run: dryRun,
    });
    if (truthErr) throw new Error(`truth_evidence: ${truthErr.message}`);
    const truthAffected = parseRpcAffected(truthData);
    phases.truth_evidence = truthData;
    totalRows += truthAffected;

    if (msAffected >= params.batchLimit || truthAffected >= params.batchLimit) {
      partial = true;
    }

    logInfo('NIGHT_MAINTENANCE_COMPLETE', { dryRun, totalRows, partial });

    await recordCronHeartbeat({
      jobName: 'night-maintenance',
      routePath: '/api/cron/night-maintenance',
      status: partial ? 'PARTIAL' : 'PASS',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      rowsAffected: totalRows,
      errorCode: partial ? 'BACKLOG_REMAINS' : null,
      errorMessage: partial ? 'One or more phases hit batch limit' : null,
    });

    return NextResponse.json(
      { ok: true, dry_run: dryRun, phases, total_rows: totalRows, partial },
      { headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('NIGHT_MAINTENANCE_FAIL', { error: msg });
    await recordCronHeartbeat({
      jobName: 'night-maintenance',
      routePath: '/api/cron/night-maintenance',
      status: 'FAIL',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      errorCode: 'NIGHT_MAINTENANCE_FAILED',
      errorMessage: msg,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: getBuildInfoHeaders() });
  } finally {
    stopHeartbeat?.();
    await releaseCronLock(LOCK_KEY);
  }
}

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runNightMaintenance(req);
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runNightMaintenance(req);
}
