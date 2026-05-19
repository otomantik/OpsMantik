/**
 * GET/POST /api/cron/cleanup — The Cleansing Protocol: Daily storage hygiene
 *
 * Order of operations (production-grade):
 * 1) Zombie recovery (2h): recover_stuck_offline_conversion_jobs (fallback buffer retired 20260419180000)
 * 2) Archive FAILED conversions to tombstones (30d)
 * 3) Delete terminal OCI queue rows (90d)
 * 4) Auto-junk stale intents — skipped (recovery_junk=1 only; SSOT = auto-junk)
 *
 * Auth: requireCronAuth (Bearer CRON_SECRET or x-vercel-cron).
 * Query: dry_run, days_to_keep, limit, days_archive_failed, days_old_intents, limit_intents, zombie_minutes
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { logInfo, logError } from '@/lib/logging/logger';
import { recordCronHeartbeat } from '@/lib/cron/heartbeat';
import { tryAcquireCronLock, releaseCronLock } from '@/lib/cron/with-cron-lock';
import {
  parseStorageCleanupParams,
  parseRpcAffected,
  assessLimitHit,
  logLimitHitAssessment,
} from '@/lib/storage/cleanup-kernel';

export const runtime = 'nodejs';

const CLEANUP_LOCK_KEY = 'cleanup';
const CLEANUP_LOCK_TTL_SEC = 3600;

const DEFAULT_DAYS_TO_KEEP = 90;
const DEFAULT_ARCHIVE_LIMIT = 5000;
const DEFAULT_OCI_QUEUE_LIMIT = 500;
const DEFAULT_DAYS_ARCHIVE_FAILED = 30;
const DEFAULT_DAYS_OLD_INTENTS = 7;
const DEFAULT_LIMIT_INTENTS = 5000;
const DEFAULT_ZOMBIE_MINUTES = 120;

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runCleanup(req);
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runCleanup(req);
}

function parseParam(req: NextRequest, key: string, defaultVal: number, min: number, max: number): number {
  const val = req.nextUrl.searchParams.get(key);
  const n = parseInt(val ?? String(defaultVal), 10);
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : defaultVal));
}

async function runCleanup(req: NextRequest) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const storageParams = parseStorageCleanupParams(req, { batchLimit: DEFAULT_OCI_QUEUE_LIMIT });
  const dryRun = storageParams.dryRun || req.nextUrl.searchParams.get('dry_run') === 'true';
  const recoveryJunk = storageParams.recoveryJunk;

  const acquired = await tryAcquireCronLock(CLEANUP_LOCK_KEY, CLEANUP_LOCK_TTL_SEC);
  if (!acquired) {
    await recordCronHeartbeat({
      jobName: 'cleanup',
      routePath: '/api/cron/cleanup',
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

  try {
  const daysToKeep = parseParam(req, 'days_to_keep', DEFAULT_DAYS_TO_KEEP, 1, 365);
  const ociLimit = parseParam(req, 'oci_limit', DEFAULT_OCI_QUEUE_LIMIT, 1, 10000);
  const limit = parseParam(req, 'limit', DEFAULT_ARCHIVE_LIMIT, 1, 10000);
  const daysArchiveFailed = parseParam(req, 'days_archive_failed', DEFAULT_DAYS_ARCHIVE_FAILED, 1, 365);
  const daysOldIntents = parseParam(req, 'days_old_intents', DEFAULT_DAYS_OLD_INTENTS, 1, 365);
  const limitIntents = parseParam(req, 'limit_intents', DEFAULT_LIMIT_INTENTS, 1, 10000);
  const zombieMinutes = parseParam(req, 'zombie_minutes', DEFAULT_ZOMBIE_MINUTES, 15, 1440);

  logInfo('CLEANUP_CRON_START', {
    dryRun,
    daysToKeep,
    ociLimit,
    archiveLimit: limit,
    daysArchiveFailed,
    daysOldIntents,
    limitIntents,
    zombieMinutes,
  });
  await recordCronHeartbeat({
    jobName: 'cleanup',
    routePath: '/api/cron/cleanup',
    status: 'RUNNING',
    startedAt,
  });

  if (dryRun) {
    const cutoffQueue = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
    const cutoffArchive = new Date(Date.now() - daysArchiveFailed * 24 * 60 * 60 * 1000).toISOString();
    const cutoffIntents = new Date(Date.now() - daysOldIntents * 24 * 60 * 60 * 1000).toISOString();

    const [queueRes, archiveRes, intentsRes] = await Promise.all([
      adminClient
        .from('offline_conversion_queue')
        .select('*', { count: 'exact', head: true })
        .in('status', ['COMPLETED', 'FATAL', 'FAILED'])
        .lt('updated_at', cutoffQueue),
      adminClient
        .from('offline_conversion_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'FAILED')
        .lt('updated_at', cutoffArchive),
      adminClient
        .from('calls')
        .select('*', { count: 'exact', head: true })
        .or('status.eq.intent,status.is.null')
        .lt('created_at', cutoffIntents),
    ]);

    logInfo('CLEANUP_CRON_DRY_RUN', {
      wouldArchiveFailed: Math.min(archiveRes.count ?? 0, limit),
      wouldDeleteQueue: Math.min(queueRes.count ?? 0, ociLimit),
      wouldJunkIntents: Math.min(intentsRes.count ?? 0, limitIntents),
    });
    await recordCronHeartbeat({
      jobName: 'cleanup',
      routePath: '/api/cron/cleanup',
      status: 'PASS',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      rowsAffected: 0,
    });

    return NextResponse.json(
      {
        ok: true,
        dry_run: true,
        zombie_recovery: { note: 'Would run recover_stuck_offline_conversion_jobs' },
        archive_failed: { would_archive: Math.min(archiveRes.count ?? 0, limit), days: daysArchiveFailed },
        oci_queue: { would_delete: Math.min(queueRes.count ?? 0, ociLimit), days_to_keep: daysToKeep },
        queue_only_mode: { legacy_signals_cleanup: 'retired' },
        auto_junk: { would_update: Math.min(intentsRes.count ?? 0, limitIntents), days_old: daysOldIntents },
      },
      { headers: getBuildInfoHeaders() }
    );
  }

  let zombiesQueue = 0;
  let archivedFailed = 0;
  let ociDeleted = 0;
  let intentsJunked = 0;
  let merkleHeartbeat: Record<string, unknown> | undefined;

  try {
    // Phase 1: Zombie recovery (2h stuck PROCESSING).
    // Fallback buffer retired 20260419180000; only the offline conversion queue
    // has a zombie-recovery path now.
    const zombieQueueRes = await adminClient.rpc('recover_stuck_offline_conversion_jobs', {
      p_min_age_minutes: zombieMinutes,
    });
    zombiesQueue = typeof zombieQueueRes.data === 'number' ? zombieQueueRes.data : 0;
    if (zombiesQueue > 0) {
      logInfo('CLEANUP_ZOMBIES_PURGED', { offline_queue: zombiesQueue });
    }

    // Phase 2: Archive FAILED conversions to tombstones (30d)
    const { data: archiveData, error: archiveErr } = await adminClient.rpc('archive_failed_conversions_batch', {
      p_days_old: daysArchiveFailed,
      p_limit: limit,
    });
    if (archiveErr) {
      logError('CLEANUP_ARCHIVE_FAIL', { error: archiveErr.message });
      await recordCronHeartbeat({
        jobName: 'cleanup',
        routePath: '/api/cron/cleanup',
        status: 'FAIL',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
        errorCode: 'ARCHIVE_FAILED',
        errorMessage: archiveErr.message,
      });
      return NextResponse.json({ error: archiveErr.message, step: 'archive_failed_conversions_batch' }, { status: 500 });
    }
    archivedFailed = typeof archiveData === 'number' ? archiveData : 0;
    if (archivedFailed > 0) {
      logInfo('CLEANUP_ARCHIVE_FAILED', { count: archivedFailed });
    }

    // Phase 3: Delete terminal OCI queue rows (90d)
    const { data: ociData, error: ociErr } = await adminClient.rpc('cleanup_oci_queue_batch', {
      p_days_to_keep: daysToKeep,
      p_limit: ociLimit,
      p_dry_run: false,
    });
    if (ociErr) {
      logError('CLEANUP_OCI_QUEUE_FAIL', { error: ociErr.message });
      await recordCronHeartbeat({
        jobName: 'cleanup',
        routePath: '/api/cron/cleanup',
        status: 'FAIL',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
        errorCode: 'OCI_QUEUE_CLEANUP_FAILED',
        errorMessage: ociErr.message,
      });
      return NextResponse.json({ error: ociErr.message, step: 'cleanup_oci_queue_batch' }, { status: 500 });
    }
    ociDeleted = parseRpcAffected(ociData);
    logLimitHitAssessment('cleanup-oci-queue', assessLimitHit(ociDeleted, ociLimit));

    // Phase 4: recovery-only stale intent junk (SSOT = auto-junk / expires_at)
    if (recoveryJunk) {
      const { data: junkData, error: junkErr } = await adminClient.rpc('cleanup_auto_junk_stale_intents', {
        p_days_old: daysOldIntents,
        p_limit: limitIntents,
      });
      if (junkErr) {
        logError('CLEANUP_AUTO_JUNK_FAIL', { error: junkErr.message });
        await recordCronHeartbeat({
          jobName: 'cleanup',
          routePath: '/api/cron/cleanup',
          status: 'FAIL',
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
          errorCode: 'AUTO_JUNK_FAILED',
          errorMessage: junkErr.message,
        });
        return NextResponse.json({ error: junkErr.message, step: 'cleanup_auto_junk_stale_intents' }, { status: 500 });
      }
      intentsJunked = typeof junkData === 'number' ? junkData : 0;
    }

    // Phase 6: Singularity — Merkle heartbeat every 1000 causal_dna_ledger entries
    const { data: merkleData, error: merkleErr } = await adminClient.rpc('heartbeat_merkle_1000');
    if (!merkleErr && merkleData && typeof merkleData === 'object') {
      merkleHeartbeat = merkleData as Record<string, unknown>;
      if (merkleHeartbeat.heartbeat) {
        logInfo('CLEANUP_MERKLE_HEARTBEAT', merkleHeartbeat);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('CLEANUP_CRON_FAIL', { error: msg });
    await recordCronHeartbeat({
      jobName: 'cleanup',
      routePath: '/api/cron/cleanup',
      status: 'FAIL',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      errorCode: 'FATAL',
      errorMessage: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  logInfo('CLEANUP_CRON_COMPLETE', {
    zombiesQueue,
    archivedFailed,
    ociDeleted,
    intentsJunked,
  });

  const backlog =
    archivedFailed >= limit ||
    ociDeleted >= ociLimit ||
    intentsJunked >= limitIntents;

  await recordCronHeartbeat({
    jobName: 'cleanup',
    routePath: '/api/cron/cleanup',
    status: backlog ? 'PARTIAL' : 'PASS',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    rowsAffected: zombiesQueue + archivedFailed + ociDeleted + intentsJunked,
    errorCode: backlog ? 'BACKLOG_REMAINS' : null,
    errorMessage: backlog ? 'Cleanup finished with remaining backlog' : null,
  });

  return NextResponse.json(
    {
      ok: true,
      dry_run: false,
      zombie_recovery: { offline_queue: zombiesQueue },
      archive_failed: { archived: archivedFailed, days: daysArchiveFailed },
      oci_queue: { deleted: ociDeleted, days_to_keep: daysToKeep, limit: ociLimit },
      queue_only_mode: { legacy_signals_cleanup: 'retired' },
      auto_junk: recoveryJunk
        ? { updated: intentsJunked, days_old: daysOldIntents, limit: limitIntents, mode: 'recovery_junk' }
        : { skipped: true, reason: 'expires_at SSOT via /api/cron/auto-junk; use ?recovery_junk=true for fallback' },
      singularity_merkle: merkleHeartbeat,
      note: backlog ? 'Backlog may remain; run again or schedule daily.' : undefined,
    },
    { headers: getBuildInfoHeaders() }
  );
  } finally {
    await releaseCronLock(CLEANUP_LOCK_KEY);
  }
}
