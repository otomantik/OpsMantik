/**
 * POST /api/cron/cleanup — Sprint 2: Daily storage hygiene
 *
 * 1) cleanup_oci_queue_batch: Delete COMPLETED/FATAL/FAILED rows from offline_conversion_queue
 *    older than p_days_to_keep (default 90). Prevents unbounded table growth.
 * 2) cleanup_auto_junk_stale_intents: Move calls with status intent/NULL older than 7 days to junk.
 *
 * Auth: requireCronAuth (Bearer CRON_SECRET or x-vercel-cron).
 * Query: dry_run=true (count only, no deletes/updates), days_to_keep (default 90), limit (default 5000),
 *        days_old_intents (default 7), limit_intents (default 5000).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { logInfo, logError } from '@/lib/logging/logger';

export const runtime = 'nodejs';

const DEFAULT_DAYS_TO_KEEP = 90;
const DEFAULT_CLEANUP_LIMIT = 5000;
const DEFAULT_DAYS_OLD_INTENTS = 7;
const DEFAULT_LIMIT_INTENTS = 5000;

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;

  const dryRun = req.nextUrl.searchParams.get('dry_run') === 'true';
  const daysToKeep = Math.min(365, Math.max(1, parseInt(req.nextUrl.searchParams.get('days_to_keep') ?? String(DEFAULT_DAYS_TO_KEEP), 10) || DEFAULT_DAYS_TO_KEEP));
  const limit = Math.min(10000, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? String(DEFAULT_CLEANUP_LIMIT), 10) || DEFAULT_CLEANUP_LIMIT));
  const daysOldIntents = Math.min(365, Math.max(1, parseInt(req.nextUrl.searchParams.get('days_old_intents') ?? String(DEFAULT_DAYS_OLD_INTENTS), 10) || DEFAULT_DAYS_OLD_INTENTS));
  const limitIntents = Math.min(10000, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit_intents') ?? String(DEFAULT_LIMIT_INTENTS), 10) || DEFAULT_LIMIT_INTENTS));

  logInfo('CLEANUP_CRON_START', { dryRun, daysToKeep, limit, daysOldIntents, limitIntents });

  if (dryRun) {
    const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
    const cutoffIntents = new Date(Date.now() - daysOldIntents * 24 * 60 * 60 * 1000).toISOString();

    const [queueRes, intentsRes] = await Promise.all([
      adminClient
        .from('offline_conversion_queue')
        .select('*', { count: 'exact', head: true })
        .in('status', ['COMPLETED', 'FATAL', 'FAILED'])
        .lt('updated_at', cutoff),
      adminClient
        .from('calls')
        .select('*', { count: 'exact', head: true })
        .or('status.eq.intent,status.is.null')
        .lt('created_at', cutoffIntents),
    ]);

    const wouldDeleteQueue = Math.min(queueRes.count ?? 0, limit);
    const wouldJunkIntents = Math.min(intentsRes.count ?? 0, limitIntents);

    logInfo('CLEANUP_CRON_DRY_RUN', { wouldDeleteQueue, wouldJunkIntents });
    return NextResponse.json(
      {
        ok: true,
        dry_run: true,
        oci_queue: { would_delete: wouldDeleteQueue, days_to_keep: daysToKeep, limit },
        auto_junk: { would_update: wouldJunkIntents, days_old: daysOldIntents, limit: limitIntents },
      },
      { headers: getBuildInfoHeaders() }
    );
  }

  let ociDeleted = 0;
  let intentsJunked = 0;

  try {
    const { data: ociResult, error: ociErr } = await adminClient.rpc('cleanup_oci_queue_batch', {
      p_days_to_keep: daysToKeep,
      p_limit: limit,
    });
    if (ociErr) {
      logError('CLEANUP_OCI_QUEUE_FAIL', { error: ociErr.message });
      return NextResponse.json({ error: ociErr.message, step: 'cleanup_oci_queue_batch' }, { status: 500 });
    }
    ociDeleted = typeof ociResult === 'number' ? ociResult : 0;

    const { data: junkResult, error: junkErr } = await adminClient.rpc('cleanup_auto_junk_stale_intents', {
      p_days_old: daysOldIntents,
      p_limit: limitIntents,
    });
    if (junkErr) {
      logError('CLEANUP_AUTO_JUNK_FAIL', { error: junkErr.message });
      return NextResponse.json({ error: junkErr.message, step: 'cleanup_auto_junk_stale_intents' }, { status: 500 });
    }
    intentsJunked = typeof junkResult === 'number' ? junkResult : 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('CLEANUP_CRON_FAIL', { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  logInfo('CLEANUP_CRON_COMPLETE', { ociDeleted, intentsJunked });

  return NextResponse.json(
    {
      ok: true,
      dry_run: false,
      oci_queue: { deleted: ociDeleted, days_to_keep: daysToKeep, limit },
      auto_junk: { updated: intentsJunked, days_old: daysOldIntents, limit: limitIntents },
      note:
        ociDeleted >= limit || intentsJunked >= limitIntents
          ? 'Backlog may remain; run again or schedule daily.'
          : undefined,
    },
    { headers: getBuildInfoHeaders() }
  );
}
