/**
 * @deprecated CUT-02D — Unscheduled (break-glass). See docs/architecture/SEAL/CRON_CONTRACT.md.
 * Replacement: `/api/cron/night-maintenance`
 */
/**
 * GET/POST /api/cron/gdpr-retention — Batch anonymize consent-less sessions/events (PR-B2).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';
import { recordCronHeartbeat } from '@/lib/cron/heartbeat';
import { tryAcquireCronLock, releaseCronLock } from '@/lib/cron/with-cron-lock';
import {
  assessLimitHit,
  logLimitHitAssessment,
  parseStorageCleanupParams,
} from '@/lib/storage/cleanup-kernel';

export const runtime = 'nodejs';

const LOCK_KEY = 'gdpr-retention';
const LOCK_TTL_SEC = 600;

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runGdprRetention(req);
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runGdprRetention(req);
}

async function runGdprRetention(req: NextRequest) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const params = parseStorageCleanupParams(req, { batchLimit: 5000, days: await parseDaysParam(req) });

  const acquired = await tryAcquireCronLock(LOCK_KEY, LOCK_TTL_SEC);
  if (!acquired) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { headers: getBuildInfoHeaders() }
    );
  }

  try {
    await recordCronHeartbeat({
      jobName: 'gdpr-retention',
      routePath: '/api/cron/gdpr-retention',
      status: 'RUNNING',
      startedAt,
    });

    const { data, error } = await adminClient.rpc('anonymize_consent_less_data_batch', {
      p_days: params.days ?? 90,
      p_limit: params.batchLimit,
      p_dry_run: params.dryRun,
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    const row =
      data && typeof data === 'object'
        ? (data as { sessions_affected?: number; events_affected?: number })
        : { sessions_affected: 0, events_affected: 0 };
    const sessionsAffected = Number(row.sessions_affected ?? 0);
    const eventsAffected = Number(row.events_affected ?? 0);
    const total = sessionsAffected + eventsAffected;

    logLimitHitAssessment('gdpr-retention', assessLimitHit(total, params.batchLimit));

    const partial = total >= params.batchLimit;
    await recordCronHeartbeat({
      jobName: 'gdpr-retention',
      routePath: '/api/cron/gdpr-retention',
      status: partial ? 'PARTIAL' : 'PASS',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      rowsAffected: total,
    });

    return NextResponse.json(
      {
        ok: true,
        dry_run: params.dryRun,
        days: params.days ?? 90,
        sessions_affected: sessionsAffected,
        events_affected: eventsAffected,
        result: data,
      },
      { headers: getBuildInfoHeaders() }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Internal error' },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  } finally {
    await releaseCronLock(LOCK_KEY);
  }
}

async function parseDaysParam(req: NextRequest): Promise<number> {
  if (req.method === 'GET') {
    const q = req.nextUrl.searchParams.get('days');
    if (q != null && q !== '') {
      const n = parseInt(q, 10);
      if (Number.isFinite(n) && n > 0) return Math.min(n, 365);
    }
    return 90;
  }
  const body = (await req.json().catch(() => ({}))) as { days?: number };
  return typeof body?.days === 'number' && body.days > 0 ? Math.min(body.days, 365) : 90;
}
