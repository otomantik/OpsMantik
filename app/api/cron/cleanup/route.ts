/**
 * GET/POST /api/cron/cleanup — The Cleansing Protocol: Daily storage hygiene
 *
 * Order of operations (production-grade):
 * 1) Zombie recovery (2h): recover_stuck_offline_conversion_jobs, recover_stuck_ingest_fallback
 * 2) Archive FAILED conversions to tombstones (30d)
 * 3) Delete terminal OCI queue rows (90d)
 * 4) Cleanup SENT marketing_signals (60d)
 * 5) Auto-junk stale intents (7d)
 *
 * Auth: requireCronAuth (Bearer CRON_SECRET or x-vercel-cron).
 * Query: dry_run, days_to_keep, limit, days_archive_failed, days_signals, days_old_intents, limit_intents, zombie_minutes
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { logInfo, logError } from '@/lib/logging/logger';

export const runtime = 'nodejs';

const DEFAULT_DAYS_TO_KEEP = 90;
const DEFAULT_CLEANUP_LIMIT = 5000;
const DEFAULT_DAYS_ARCHIVE_FAILED = 30;
const DEFAULT_DAYS_SIGNALS = 60;
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
  const dryRun = req.nextUrl.searchParams.get('dry_run') === 'true';
  const daysToKeep = parseParam(req, 'days_to_keep', DEFAULT_DAYS_TO_KEEP, 1, 365);
  const limit = parseParam(req, 'limit', DEFAULT_CLEANUP_LIMIT, 1, 10000);
  const daysArchiveFailed = parseParam(req, 'days_archive_failed', DEFAULT_DAYS_ARCHIVE_FAILED, 1, 365);
  const daysSignals = parseParam(req, 'days_signals', DEFAULT_DAYS_SIGNALS, 1, 365);
  const daysOldIntents = parseParam(req, 'days_old_intents', DEFAULT_DAYS_OLD_INTENTS, 1, 365);
  const limitIntents = parseParam(req, 'limit_intents', DEFAULT_LIMIT_INTENTS, 1, 10000);
  const zombieMinutes = parseParam(req, 'zombie_minutes', DEFAULT_ZOMBIE_MINUTES, 15, 1440);

  logInfo('CLEANUP_CRON_START', {
    dryRun,
    daysToKeep,
    limit,
    daysArchiveFailed,
    daysSignals,
    daysOldIntents,
    limitIntents,
    zombieMinutes,
  });

  if (dryRun) {
    const cutoffQueue = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
    const cutoffArchive = new Date(Date.now() - daysArchiveFailed * 24 * 60 * 60 * 1000).toISOString();
    const cutoffSignals = new Date(Date.now() - daysSignals * 24 * 60 * 60 * 1000).toISOString();
    const cutoffIntents = new Date(Date.now() - daysOldIntents * 24 * 60 * 60 * 1000).toISOString();

    const [queueRes, archiveRes, signalsRes, intentsRes] = await Promise.all([
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
        .from('marketing_signals')
        .select('*', { count: 'exact', head: true })
        .eq('dispatch_status', 'SENT')
        .lt('created_at', cutoffSignals),
      adminClient
        .from('calls')
        .select('*', { count: 'exact', head: true })
        .or('status.eq.intent,status.is.null')
        .lt('created_at', cutoffIntents),
    ]);

    logInfo('CLEANUP_CRON_DRY_RUN', {
      wouldArchiveFailed: Math.min(archiveRes.count ?? 0, limit),
      wouldDeleteQueue: Math.min(queueRes.count ?? 0, limit),
      wouldDeleteSignals: Math.min(signalsRes.count ?? 0, limit),
      wouldJunkIntents: Math.min(intentsRes.count ?? 0, limitIntents),
    });

    return NextResponse.json(
      {
        ok: true,
        dry_run: true,
        zombie_recovery: { note: 'Would run recover_stuck (offline_queue + ingest_fallback)' },
        archive_failed: { would_archive: Math.min(archiveRes.count ?? 0, limit), days: daysArchiveFailed },
        oci_queue: { would_delete: Math.min(queueRes.count ?? 0, limit), days_to_keep: daysToKeep },
        marketing_signals: { would_delete: Math.min(signalsRes.count ?? 0, limit), days: daysSignals },
        auto_junk: { would_update: Math.min(intentsRes.count ?? 0, limitIntents), days_old: daysOldIntents },
      },
      { headers: getBuildInfoHeaders() }
    );
  }

  let zombiesQueue = 0;
  let zombiesFallback = 0;
  let archivedFailed = 0;
  let ociDeleted = 0;
  let signalsDeleted = 0;
  let intentsJunked = 0;

  try {
    // Phase 1: Zombie recovery (2h stuck PROCESSING)
    const [zombieQueueRes, zombieFallbackRes] = await Promise.all([
      adminClient.rpc('recover_stuck_offline_conversion_jobs', { p_min_age_minutes: zombieMinutes }),
      adminClient.rpc('recover_stuck_ingest_fallback', { p_min_age_minutes: zombieMinutes }),
    ]);
    zombiesQueue = typeof zombieQueueRes.data === 'number' ? zombieQueueRes.data : 0;
    zombiesFallback = typeof zombieFallbackRes.data === 'number' ? zombieFallbackRes.data : 0;
    if (zombiesQueue > 0 || zombiesFallback > 0) {
      logInfo('CLEANUP_ZOMBIES_PURGED', { offline_queue: zombiesQueue, ingest_fallback: zombiesFallback });
    }

    // Phase 2: Archive FAILED conversions to tombstones (30d)
    const { data: archiveData, error: archiveErr } = await adminClient.rpc('archive_failed_conversions_batch', {
      p_days_old: daysArchiveFailed,
      p_limit: limit,
    });
    if (archiveErr) {
      logError('CLEANUP_ARCHIVE_FAIL', { error: archiveErr.message });
      return NextResponse.json({ error: archiveErr.message, step: 'archive_failed_conversions_batch' }, { status: 500 });
    }
    archivedFailed = typeof archiveData === 'number' ? archiveData : 0;
    if (archivedFailed > 0) {
      logInfo('CLEANUP_ARCHIVE_FAILED', { count: archivedFailed });
    }

    // Phase 3: Delete terminal OCI queue rows (90d)
    const { data: ociData, error: ociErr } = await adminClient.rpc('cleanup_oci_queue_batch', {
      p_days_to_keep: daysToKeep,
      p_limit: limit,
    });
    if (ociErr) {
      logError('CLEANUP_OCI_QUEUE_FAIL', { error: ociErr.message });
      return NextResponse.json({ error: ociErr.message, step: 'cleanup_oci_queue_batch' }, { status: 500 });
    }
    ociDeleted = typeof ociData === 'number' ? ociData : 0;

    // Phase 4: Cleanup SENT marketing_signals (60d)
    const { data: signalsData, error: signalsErr } = await adminClient.rpc('cleanup_marketing_signals_batch', {
      p_days_old: daysSignals,
      p_limit: limit,
    });
    if (signalsErr) {
      logError('CLEANUP_SIGNALS_FAIL', { error: signalsErr.message });
      return NextResponse.json({ error: signalsErr.message, step: 'cleanup_marketing_signals_batch' }, { status: 500 });
    }
    signalsDeleted = typeof signalsData === 'number' ? signalsData : 0;

    // Phase 5: Auto-junk stale intents (7d)
    const { data: junkData, error: junkErr } = await adminClient.rpc('cleanup_auto_junk_stale_intents', {
      p_days_old: daysOldIntents,
      p_limit: limitIntents,
    });
    if (junkErr) {
      logError('CLEANUP_AUTO_JUNK_FAIL', { error: junkErr.message });
      return NextResponse.json({ error: junkErr.message, step: 'cleanup_auto_junk_stale_intents' }, { status: 500 });
    }
    intentsJunked = typeof junkData === 'number' ? junkData : 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('CLEANUP_CRON_FAIL', { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  logInfo('CLEANUP_CRON_COMPLETE', {
    zombiesQueue,
    zombiesFallback,
    archivedFailed,
    ociDeleted,
    signalsDeleted,
    intentsJunked,
  });

  const backlog =
    archivedFailed >= limit ||
    ociDeleted >= limit ||
    signalsDeleted >= limit ||
    intentsJunked >= limitIntents;

  return NextResponse.json(
    {
      ok: true,
      dry_run: false,
      zombie_recovery: { offline_queue: zombiesQueue, ingest_fallback: zombiesFallback },
      archive_failed: { archived: archivedFailed, days: daysArchiveFailed },
      oci_queue: { deleted: ociDeleted, days_to_keep: daysToKeep, limit },
      marketing_signals: { deleted: signalsDeleted, days: daysSignals, limit },
      auto_junk: { updated: intentsJunked, days_old: daysOldIntents, limit: limitIntents },
      note: backlog ? 'Backlog may remain; run again or schedule daily.' : undefined,
    },
    { headers: getBuildInfoHeaders() }
  );
}
