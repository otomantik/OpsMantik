/**
 * GET/POST /api/cron/sweep-unsent-conversions
 *
 * Self-healing sweeper: finds calls that are sale-terminal (oci_status='sealed'
 * or status='won') but not in
 * offline_conversion_queue (e.g. sealed via auto-approve cron or failed API).
 * Passes each through enqueueSealConversion() so OCI queue is filled without
 * manual DB intervention.
 *
 * Scope: last 7 days. Auth: requireCronAuth (Bearer CRON_SECRET / x-vercel-cron).
 * Vercel Cron sends GET; POST kept for manual/Bearer calls.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { tryAcquireCronLockDetailed, releaseCronLock } from '@/lib/cron/with-cron-lock';
import { getRefactorFlags } from '@/lib/refactor/flags';
import { adminClient } from '@/lib/supabase/admin';
import { enqueueSealConversion } from '@/lib/oci/enqueue-seal-conversion';
import { normalizeCurrencyOrNeutral } from '@/lib/i18n/site-locale';
import {
  buildOrphanWorkset,
  normalizeSweepSkippedReason,
  type SweepSkippedReason,
} from '@/lib/oci/sweep-unsent-conversions-core';

export const runtime = 'nodejs';

const LOOKBACK_DAYS = 7;
const MAX_ORPHANS_PER_RUN = 500;
const CRON_LOCK_TTL_SEC = 300; // 5 min — exceeds 15-min schedule
const SWEEP_LOCK_GLOBAL_PATH = 'sweep-unsent-conversions';
const UUID_V4_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseFlag(value: string | null): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function normalizeSiteId(value: string | null): string | null {
  const siteId = value?.trim() || null;
  if (!siteId) return null;
  return UUID_V4_LIKE.test(siteId) ? siteId : null;
}

function hasRepairIntent(req: NextRequest): boolean {
  const q = req.nextUrl.searchParams;
  return (
    q.has('change_ticket') ||
    q.has('operator_id') ||
    q.has('confirm') ||
    req.headers.has('x-opsmantik-change-ticket') ||
    req.headers.has('x-opsmantik-operator-id') ||
    req.headers.has('x-opsmantik-repair-confirm')
  );
}

function deriveSweepLockPath(siteId?: string | null): string {
  return siteId ? `${SWEEP_LOCK_GLOBAL_PATH}:site:${siteId}` : SWEEP_LOCK_GLOBAL_PATH;
}

async function runSweep(req: NextRequest) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400 * 1000);
  const sinceIso = since.toISOString();
  const targetSiteIdRaw = req.nextUrl.searchParams.get('site_id');
  const targetSiteId = normalizeSiteId(targetSiteIdRaw);
  const hasSiteIdParam = Boolean(targetSiteIdRaw?.trim());
  const dryRun = parseFlag(req.nextUrl.searchParams.get('dry_run'));

  if (hasSiteIdParam && !targetSiteId) {
    return NextResponse.json(
      { ok: false, error: 'invalid_site_id', code: 'INVALID_SITE_ID' },
      { status: 400, headers: getBuildInfoHeaders() }
    );
  }
  if (hasRepairIntent(req) && !targetSiteId) {
    return NextResponse.json(
      { ok: false, error: 'site_id_required_for_repair', code: 'SITE_ID_REQUIRED' },
      { status: 400, headers: getBuildInfoHeaders() }
    );
  }

  try {
    // P0-1.1: Cap to prevent memory exhaustion at scale
    const QUEUE_SCAN_LIMIT = 5000;
    const queueQuery = adminClient
      .from('offline_conversion_queue')
      .select('call_id')
      .not('call_id', 'is', null)
      .limit(QUEUE_SCAN_LIMIT);
    if (targetSiteId) queueQuery.eq('site_id', targetSiteId);

    const callsQuery = adminClient
      .from('calls')
      .select('id, site_id, status, oci_status, confirmed_at, sale_amount, currency, lead_score')
      .or('oci_status.eq.sealed,status.eq.won')
      .gte('confirmed_at', sinceIso)
      .not('confirmed_at', 'is', null)
      .order('confirmed_at', { ascending: false })
      .limit(MAX_ORPHANS_PER_RUN * 2);
    if (targetSiteId) callsQuery.eq('site_id', targetSiteId);

    const [{ data: queueRows }, { data: sealedCalls, error: callsError }] = await Promise.all([queueQuery, callsQuery]);

    if (callsError) {
      return NextResponse.json(
        { ok: false, error: callsError.message },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    const queuedCallIds = new Set((queueRows ?? []).map((r) => r.call_id as string).filter(Boolean));
    const workset = buildOrphanWorkset(
      (sealedCalls ?? []) as Array<{
        id: string | null;
        site_id: string | null;
        status?: string | null;
        oci_status?: string | null;
        confirmed_at?: string | null;
      }>,
      queuedCallIds
    );
    const orphans = workset.orphans;

    let enqueued = 0;
    const skipped: Record<SweepSkippedReason, number> = { ...workset.skipped };
    const errors: string[] = [];

    for (const call of orphans.slice(0, MAX_ORPHANS_PER_RUN)) {
      if (!call.id || !call.site_id || !call.confirmed_at) {
        skipped.unknown = (skipped.unknown ?? 0) + 1;
        continue;
      }
      if (dryRun) continue;
      const result = await enqueueSealConversion({
        callId: call.id,
        siteId: call.site_id,
        confirmedAt: call.confirmed_at,
        saleAmount: call.sale_amount ?? null,
        currency: normalizeCurrencyOrNeutral(call.currency),
        leadScore: call.lead_score ?? null,
        entryReason: 'sweep_unsent_conversions',
      });

      if (result.enqueued) {
        enqueued++;
        queuedCallIds.add(call.id);
      } else {
        const reason = normalizeSweepSkippedReason(result.reason);
        skipped[reason] = (skipped[reason] ?? 0) + 1;
        if (result.error) errors.push(`${call.id}: ${result.error}`);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        mode: dryRun ? 'dry-run' : 'write',
        target_site_id: targetSiteId,
        discovered_won: workset.discoveredWon,
        discovered_sealed: workset.discoveredSealed,
        orphaned: orphans.length,
        processed: Math.min(orphans.length, MAX_ORPHANS_PER_RUN),
        won_enqueued: enqueued,
        enqueued,
        skipped,
        errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
        since: sinceIso,
      },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg, code: 'SWEEP_UNSENT_CONVERSIONS_ERROR' },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}

async function handlerWithLock(req: NextRequest) {
  const targetSiteId = normalizeSiteId(req.nextUrl.searchParams.get('site_id'));
  const lockPath = deriveSweepLockPath(targetSiteId);
  const acquire = await tryAcquireCronLockDetailed(lockPath, CRON_LOCK_TTL_SEC);
  if (!acquire.acquired) {
    return NextResponse.json(
      {
        ok: true,
        skipped: true,
        reason: acquire.reason,
        lock_path: lockPath,
        lock_ttl_sec: CRON_LOCK_TTL_SEC,
        lock_mode: getRefactorFlags().lease_lock_mode,
        lock_backend: acquire.backend,
        lock_error_code: acquire.error_code,
      },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  }
  try {
    return await runSweep(req);
  } finally {
    await releaseCronLock(lockPath);
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
