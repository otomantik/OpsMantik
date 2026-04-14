import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { adminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging/logger';
import { isRecord, parseValidWorkerJobData } from '@/lib/types/ingest';
import { SiteService } from '@/lib/services/site-service';
import { runSyncGates } from '@/lib/ingest/sync-gates';
import { processSyncEvent, DedupSkipError, getDedupEventIdForJob } from '@/lib/ingest/process-sync-event';
import { getSiteIngestConfig } from '@/lib/ingest/site-ingest-config';
import { isCommonBotUA, isAllowedReferrer, hasValidClickId } from '@/lib/ingest/bot-referrer-gates';
import { getFinalUrl } from '@/lib/types/ingest';
import {
  computeIdempotencyKey,
  computeIdempotencyKeyV2,
  getServerNowMs,
  tryInsertIdempotencyKey,
} from '@/lib/idempotency';
import { checkAndIncrementFraudFingerprint } from '@/lib/services/fraud-quarantine-service';
import { isCallEventWorkerPayload } from '@/lib/ingest/call-event-worker-payload';
import { processCallEvent } from '@/lib/ingest/process-call-event';
import { incrementBillingIngestAllowed } from '@/lib/billing-metrics';
import { incrementUsageRedis } from '@/lib/quota';
import { getCurrentYearMonthUTC } from '@/lib/quota';
import { applyRefactorObservability } from '@/lib/refactor/phase-context';

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

export type IngestLane = 'telemetry' | 'conversion';

/**
 * Core Ingest Execution Logic (The Singularity)
 * Supports both Telemetry (Fast-Lane) and Conversion (Value-Lane).
 */
export async function executeIngest(req: NextRequest, lane: IngestLane) {
  let qstashMessageId: string | null = null;
  let siteDbId: string | null = null;
  let rawBody: unknown = null;
  const requestId = req.headers.get('x-request-id') || req.headers.get('om-trace-uuid') || undefined;

  try {
    qstashMessageId = req.headers.get('Upstash-Message-Id') || req.headers.get('upstash-message-id') || null;
    rawBody = await req.json();

    if (isRecord(rawBody) && 'kind' in rawBody && rawBody.kind === 'oci_export') {
      const { processSingleOciExport } = await import('@/lib/oci/process-single-oci-export');
      const qId = (rawBody as Record<string, unknown>).queue_id;
      const sId = (rawBody as Record<string, unknown>).site_id;
      const result = await processSingleOciExport(String(qId), String(sId));
      return NextResponse.json({ success: true, oci_status: result.status, lane });
    }

    Sentry.setTag('ingest_lane', lane);

    if (isCallEventWorkerPayload(rawBody)) {
      applyRefactorObservability({
        route_name: 'workers_ingest_call_event',
        site_id: typeof rawBody.site_id === 'string' ? rawBody.site_id : null,
        ingest_lane: lane,
      });
      const result = await processCallEvent(rawBody, requestId);
      siteDbId = rawBody.site_id;
      return NextResponse.json({ success: true, call_id: result.call_id, lane });
    }

    const parsed = parseValidWorkerJobData(rawBody);
    if (parsed.kind !== 'ok') return NextResponse.json({ ok: true, skipped: 'invalid_payload' });

    const job = parsed.data;
    const site_id = job.s;
    const ingest_id = typeof job.ingest_id === 'string' ? job.ingest_id : undefined;

    Sentry.setTag('ingest_id', ingest_id || 'none');
    Sentry.setTag('qstash_message_id', qstashMessageId || 'none');
    Sentry.setContext('workers_ingest', {
      ingest_id: ingest_id || null,
      qstash_message_id: qstashMessageId || null,
      site_public_id: site_id,
      lane,
    });

    const { valid: siteValid, site } = await SiteService.validateSite(site_id);
    if (!siteValid || !site) return NextResponse.json({ ok: true, skipped: 'site_invalid' });
    siteDbId = site.id;

    applyRefactorObservability({
      route_name: 'workers_ingest_sync',
      site_id: site.id,
      ingest_lane: lane,
    });

    const fingerprint = (job.meta && typeof (job.meta as Record<string, unknown>).fp === 'string')
      ? String((job.meta as Record<string, unknown>).fp).trim()
      : (typeof job.sid === 'string' ? job.sid.trim() : '');
    
    const fraudCheck = await checkAndIncrementFraudFingerprint(site.id, fingerprint);
    if (fraudCheck.quarantine) {
      try {
        await adminClient.from('ingest_fraud_quarantine').insert({
          site_id: site.id,
          payload: rawBody as Record<string, unknown>,
          reason: fraudCheck.reason,
          fingerprint: fingerprint || null,
          ip_address: typeof job.ip === 'string' ? job.ip : null,
          lane,
        });
      } catch { /* best-effort */ }
      return NextResponse.json({ ok: true, quarantine: true, reason: fraudCheck.reason });
    }

    // Traffic debloat
    const siteIngestConfig = await getSiteIngestConfig(site.id);
    const trafficDebloat = siteIngestConfig.traffic_debloat || siteIngestConfig.ingest_strict_mode;
    if (trafficDebloat) {
      const url = getFinalUrl(job as import('@/lib/types/ingest').ValidIngestPayload);
      const ua = typeof job.ua === 'string' ? job.ua : '';
      const referrer = typeof job.r === 'string' ? job.r : null;
      let eventHost = '';
      try {
        eventHost = new URL(url).hostname || '';
      } catch {
        eventHost = '';
      }
      const meta = (job.meta ?? {}) as Record<string, unknown>;
      let gclid: string | null = typeof meta.gclid === 'string' ? meta.gclid : null;
      let wbraid: string | null = typeof meta.wbraid === 'string' ? meta.wbraid : null;
      let gbraid: string | null = typeof meta.gbraid === 'string' ? meta.gbraid : null;
      try {
        const u = new URL(url);
        if (!gclid && u.searchParams.get('gclid')) gclid = u.searchParams.get('gclid');
        if (!wbraid && u.searchParams.get('wbraid')) wbraid = u.searchParams.get('wbraid');
        if (!gbraid && u.searchParams.get('gbraid')) gbraid = u.searchParams.get('gbraid');
      } catch { /* ignore */ }
      const hasClickId = hasValidClickId({ gclid, wbraid, gbraid });

      const botSkip = isCommonBotUA(ua, { allowPreviewUAs: siteIngestConfig.ingest_allow_preview_uas });
      const referrerAllowed = isAllowedReferrer(referrer, url, {
        allowlist: siteIngestConfig.referrer_allowlist,
        blocklist: siteIngestConfig.referrer_blocklist,
        eventHost,
      });
      const referrerSkip = !referrerAllowed && !hasClickId;

      if (botSkip || referrerSkip) {
        const skipReasonApi = botSkip ? 'bot_ua' : 'referrer_blocked';
        const idempotencyVersion = process.env.OPSMANTIK_IDEMPOTENCY_VERSION === '2' ? '2' : '1';
        const idempotencyKey =
          idempotencyVersion === '2'
            ? await computeIdempotencyKeyV2(site.id, job, getServerNowMs())
            : await computeIdempotencyKey(site.id, job);
        
        const idemResult = await tryInsertIdempotencyKey(site.id, idempotencyKey, {
          billable: false,
          billingReason: skipReasonApi,
          eventCategory: typeof job.ec === 'string' ? job.ec : null,
          eventAction: typeof job.ea === 'string' ? job.ea : null,
          eventLabel: typeof job.el === 'string' ? job.el : null,
        });
        if (idemResult.duplicate) return NextResponse.json({ ok: true, skipped: true, reason: skipReasonApi });
        
        const dedupEventId = await getDedupEventIdForJob(job, url, qstashMessageId);
        try {
          await adminClient.from('processed_signals').insert({
            event_id: dedupEventId,
            site_id: site.id,
            status: 'skipped',
          });
        } catch (psErr) {
          const code = (psErr as { code?: string })?.code;
          const msg = String((psErr as { message?: string })?.message ?? '');
          if (code !== '23505' && !/duplicate key/i.test(msg)) throw psErr;
        }
        return NextResponse.json({ ok: true, skipped: true, reason: skipReasonApi });
      }
    }

    const gatesResult = await runSyncGates(job, site.id);
    if (gatesResult.ok === false) {
      return NextResponse.json({ ok: true, reason: gatesResult.reason });
    }

    let processResult;
    try {
      processResult = await processSyncEvent(job, site.id, qstashMessageId);
    } catch (syncError) {
      if (gatesResult.billable && gatesResult.idempotencyKey) {
        const currentMonthStart = `${getCurrentYearMonthUTC()}-01`;
        try {
          await adminClient.rpc('decrement_and_delete_idempotency', {
            p_site_id: site.id,
            p_month: currentMonthStart,
            p_idempotency_key: gatesResult.idempotencyKey,
            p_kind: 'revenue_events',
          });
        } catch (compErr) {
          logError('WORKERS_INGEST_COMPENSATION_FAILED', {
            site_id: site.id,
            idempotency_key: gatesResult.idempotencyKey,
            error: String(compErr),
            lane,
          });
        }
      }
      throw syncError;
    }

    if (gatesResult.billable) {
      const yearMonth = getCurrentYearMonthUTC();
      await incrementUsageRedis(site.id, yearMonth);
      incrementBillingIngestAllowed();
    }

    return NextResponse.json({ success: true, score: processResult.score, lane });
  } catch (error) {
    if (error instanceof DedupSkipError) {
      return NextResponse.json({ ok: true, dedup: true });
    }

    const ingestIdFromPayload = isRecord(rawBody) && typeof rawBody.ingest_id === 'string' ? rawBody.ingest_id : null;
    const retryable = isRetryableError(error);
    
    Sentry.setContext('workers_ingest_error', {
      ingest_id: ingestIdFromPayload,
      qstash_message_id: qstashMessageId,
      site_id: siteDbId,
      retryable,
      lane,
    });

    if (!retryable) {
      try {
        await adminClient.from('sync_dlq').insert({
          site_id: siteDbId,
          qstash_message_id: qstashMessageId,
          dedup_event_id: null,
          stage: `workers_ingest_${lane}`,
          error: getErrorMessage(error),
          payload: isRecord(rawBody) ? rawBody : { note: 'rawBody_unavailable' },
        });
      } catch { /* ignore */ }

      logError('QSTASH_WORKER_DLQ', {
        lane,
        ingest_id: ingestIdFromPayload ?? undefined,
        site_id: siteDbId ?? undefined,
        error: getErrorMessage(error),
      });
      Sentry.captureException(error);
      return NextResponse.json({ ok: true, dlq: true });
    }

    logError('QSTASH_WORKER_ERROR', {
      lane,
      ingest_id: ingestIdFromPayload ?? undefined,
      site_id: siteDbId ?? undefined,
      error: getErrorMessage(error),
    });
    Sentry.captureException(error);
    return NextResponse.json({ error: 'Worker failed' }, { status: 500 });
  }
}
