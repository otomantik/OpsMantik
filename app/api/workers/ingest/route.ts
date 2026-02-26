/**
 * Unified async ingest worker: sync events and call-event.
 * QStash signature required.
 * Sync: idempotency, quota, entitlements, session/event/intent.
 * Call-event: insert call + audit (HMAC, replay, consent validated in receiver).
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { adminClient } from '@/lib/supabase/admin';
import { assertQstashEnv } from '@/lib/qstash/env';
import { requireQstashSignature } from '@/lib/qstash/require-signature';
import { logError } from '@/lib/logging/logger';
import { isRecord, parseValidWorkerJobData } from '@/lib/types/ingest';
import { SiteService } from '@/lib/services/site-service';
import { runSyncGates } from '@/lib/ingest/sync-gates';
import { processSyncEvent, DedupSkipError } from '@/lib/ingest/process-sync-event';
import { isCallEventWorkerPayload } from '@/lib/ingest/call-event-worker-payload';
import { processCallEvent } from '@/lib/ingest/process-call-event';
import { incrementBillingIngestAllowed } from '@/lib/billing-metrics';
import { incrementUsageRedis } from '@/lib/quota';
import { getCurrentYearMonthUTC } from '@/lib/quota';

export const runtime = 'nodejs';

assertQstashEnv();

type ErrorLike = { code?: unknown; message?: unknown; status?: unknown };

function asErrorLike(err: unknown): ErrorLike {
  return isRecord(err) ? (err as ErrorLike) : {};
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && typeof err.message === 'string') return err.message;
  const e = asErrorLike(err);
  if (typeof e.message === 'string') return e.message;
  return String(err);
}

function getQstashMessageId(req: NextRequest): string | null {
  return req.headers.get('Upstash-Message-Id') || req.headers.get('upstash-message-id') || null;
}

function isRetryableError(err: unknown): boolean {
  const e = asErrorLike(err);
  const message = typeof e.message === 'string' ? e.message : String(err);
  const code = typeof e.code === 'string' ? e.code : '';
  const status = typeof e.status === 'number' ? e.status : undefined;

  if (status && [408, 429, 500, 502, 503, 504].includes(status)) return true;
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|EPIPE|fetch failed|network|temporarily unavailable/i.test(message)) return true;
  if (/rate limit|too many requests/i.test(message)) return true;
  if (code === '23505') return false;
  return false;
}

async function handler(req: NextRequest) {
  let qstashMessageId: string | null = null;
  let siteDbId: string | null = null;
  let rawBody: unknown = null;

  try {
    qstashMessageId = getQstashMessageId(req);
    rawBody = await req.json();

    if (isCallEventWorkerPayload(rawBody)) {
      const result = await processCallEvent(rawBody, req.headers.get('x-request-id') ?? undefined);
      siteDbId = rawBody.site_id;
      return NextResponse.json({ success: true, call_id: result.call_id });
    }

    const parsed = parseValidWorkerJobData(rawBody);
    if (parsed.kind !== 'ok') return NextResponse.json({ ok: true });

    const job = parsed.data;
    const site_id = job.s;
    const ingest_id = typeof job.ingest_id === 'string' ? job.ingest_id : undefined;

    Sentry.setTag('ingest_id', ingest_id || 'none');
    Sentry.setTag('qstash_message_id', qstashMessageId || 'none');
    Sentry.setContext('workers_ingest', {
      ingest_id: ingest_id || null,
      qstash_message_id: qstashMessageId || null,
      site_public_id: site_id,
    });

    const { valid: siteValid, site } = await SiteService.validateSite(site_id);
    if (!siteValid || !site) return NextResponse.json({ ok: true });
    siteDbId = site.id;

    const gatesResult = await runSyncGates(job, site.id);
    if (gatesResult.ok === false) {
      const reason = gatesResult.reason;
      if (reason === 'idempotency_error') {
        logError('WORKERS_INGEST_BILLING_GATE_CLOSED', {
          route: 'workers_ingest',
          site_id,
          error: String(gatesResult.error),
        });
        return NextResponse.json({ ok: true, reason });
      }
      return NextResponse.json({ ok: true, reason });
    }

    const processResult = await processSyncEvent(job, site.id, qstashMessageId);

    if (gatesResult.billable) {
      const yearMonth = getCurrentYearMonthUTC();
      await incrementUsageRedis(site.id, yearMonth);
      incrementBillingIngestAllowed();
    }

    return NextResponse.json({ success: true, score: processResult.score });
  } catch (error) {
    if (error instanceof DedupSkipError) {
      return NextResponse.json({ ok: true, dedup: true });
    }

    const ingestIdFromPayload = isRecord(rawBody) && typeof rawBody.ingest_id === 'string' ? rawBody.ingest_id : null;
    const retryable = isRetryableError(error);
    Sentry.setTag('ingest_id', ingestIdFromPayload || 'none');
    Sentry.setContext('workers_ingest_error', {
      ingest_id: ingestIdFromPayload,
      qstash_message_id: qstashMessageId,
      site_id: siteDbId,
      retryable,
    });

    if (!retryable) {
      try {
        await adminClient.from('sync_dlq').insert({
          site_id: siteDbId,
          qstash_message_id: qstashMessageId,
          dedup_event_id: null,
          stage: 'workers_ingest',
          error: getErrorMessage(error),
          payload: isRecord(rawBody) ? rawBody : { note: 'rawBody_unavailable_or_non_object' },
        });
      } catch { /* ignore */ }

      logError('QSTASH_WORKER_DLQ', {
        route: 'workers_ingest',
        ingest_id: ingestIdFromPayload ?? undefined,
        qstash_message_id: qstashMessageId ?? undefined,
        site_id: siteDbId ?? undefined,
        error: getErrorMessage(error),
      });
      Sentry.captureException(error);
      return NextResponse.json({ ok: true, dlq: true });
    }

    logError('QSTASH_WORKER_ERROR', {
      route: 'workers_ingest',
      ingest_id: ingestIdFromPayload ?? undefined,
      qstash_message_id: qstashMessageId ?? undefined,
      site_id: siteDbId ?? undefined,
      error: getErrorMessage(error),
    });
    Sentry.captureException(error);
    return NextResponse.json({ error: 'Worker failed' }, { status: 500 });
  }
}

export const POST = requireQstashSignature(handler);
