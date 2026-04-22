/**
 * POST /api/oci/ack-failed — Script validation/upload fail sonrası: PROCESSING → FAILED.
 *
 * Script validation (INVALID_TIME_FORMAT vb) veya upload red aldığında bu endpoint'i çağırır.
 * Satırlar FAILED olur, last_error yazılır; recover-processing bunlara dokunmaz.
 *
 * Body: { siteId: string, queueIds: string[], errorCode?: string, errorMessage?: string, errorCategory?: 'VALIDATION'|'TRANSIENT'|'AUTH' }
 * Auth: Bearer session_token veya x-api-key (export/ack ile aynı).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { MAX_ATTEMPTS } from '@/lib/domain/oci/queue-types';
import { insertDeadLetterAuditLogs } from '@/lib/oci/dead-letter-audit';
import { redis } from '@/lib/upstash';
import { getPvDataKey, getPvProcessingKeysForCleanup, getPvQueueKey } from '@/lib/oci/pv-redis';
import { buildAckPayloadHash, completeAckReceipt, registerAckReceipt } from '@/lib/oci/ack-receipt';
import { addSecondsIso, getDbNowIso } from '@/lib/time/db-now';
import { sortDeterministicIds } from '@/lib/oci/deterministic-scheduler';
import { appendRoutingHop } from '@/lib/oci/routing-ledger';
import { applyMarketingSignalDispatchBatch } from '@/lib/oci/marketing-signal-dispatch-kernel';
import { assertLaneActive } from '@/lib/oci/kill-switch';
import { logError, logInfo } from '@/lib/logging/logger';
import { splitAckPrefixedIds } from '@/lib/oci/ack-id-groups';
import { resolveOciScriptAuth } from '@/lib/oci/script-auth';
import * as jose from 'jose';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type AckFailedCategory = 'VALIDATION' | 'TRANSIENT' | 'AUTH';

function getAuditErrorCategory(category: AckFailedCategory, maxAttemptsHit: boolean): 'PERMANENT' | 'VALIDATION' | 'AUTH' | 'MAX_ATTEMPTS' {
  if (maxAttemptsHit) return 'MAX_ATTEMPTS';
  if (category === 'VALIDATION') return 'VALIDATION';
  if (category === 'AUTH') return 'AUTH';
  return 'PERMANENT';
}

export async function POST(req: NextRequest) {
  try {
    const lane = assertLaneActive('OCI_ACK');
    if (!lane.ok) {
      return NextResponse.json({ error: 'OCI ACK paused', code: lane.code }, { status: 503 });
    }
    // Phase 8.2: JWS Asymmetric Signature Verification (Optional enforcement)
    const signature = req.headers.get('x-oci-signature');
    const publicKeyB64 = process.env.VOID_PUBLIC_KEY;
    if (publicKeyB64 && signature) {
      try {
        const publicKey = await jose.importSPKI(Buffer.from(publicKeyB64, 'base64').toString('utf8'), 'RS256');
        await jose.jwtVerify(signature, publicKey, {
          issuer: 'opsmantik-oci-script',
          audience: 'opsmantik-api',
        });
      } catch (err) {
        logError('OCI_ACK_FAILED_CRYPTO_MISMATCH', { error: err instanceof Error ? err.message : String(err) });
        return NextResponse.json({ error: 'Cryptographic Mismatch', code: 'AUTH_FAILED' }, { status: 401 });
      }
    }

    const bodyUnknown = await req.json().catch(() => ({}));
    const body =
      bodyUnknown && typeof bodyUnknown === 'object' && !Array.isArray(bodyUnknown)
        ? (bodyUnknown as Record<string, unknown>)
        : {};
    const siteIdFromBody = typeof body.siteId === 'string' ? body.siteId : undefined;
    const auth = await resolveOciScriptAuth({
      req,
      siteIdFromBody,
      authFailNamespace: 'oci-ack-failed-authfail',
    });
    if (!auth.ok) return auth.response;
    const siteUuid = auth.siteUuid;
    const resolvedSite = auth.resolvedSite;
    const rawIds = Array.isArray(body.queueIds) ? body.queueIds : [];
    const queueIds = sortDeterministicIds(
      rawIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    );

    // Phase 6.3: Poison Pill Fatal Errors
    const rawFatal = Array.isArray(body.fatalErrorIds) ? body.fatalErrorIds : [];
    const fatalIds = sortDeterministicIds(
      rawFatal.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    );

    const errorCode = typeof body.errorCode === 'string' ? body.errorCode.trim().slice(0, 64) : 'VALIDATION_FAILED';
    const errorMessage = typeof body.errorMessage === 'string' ? body.errorMessage.trim().slice(0, 1024) : errorCode;
    const rawCategory = typeof body.errorCategory === 'string' ? body.errorCategory : '';
    const category: AckFailedCategory = ['VALIDATION', 'TRANSIENT', 'AUTH'].includes(rawCategory)
      ? (rawCategory as AckFailedCategory)
      : 'VALIDATION';

    if (queueIds.length === 0 && fatalIds.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    const { sealIds: sealFailedIds, signalIds: signalFailedIds, pvIds: pvFailedIds } = splitAckPrefixedIds(queueIds);
    const { sealIds: sealFatalIds, signalIds: signalFatalIds, pvIds: pvFatalIds } = splitAckPrefixedIds(fatalIds);

    const now = await getDbNowIso();
    const requestFingerprint = [
      req.headers.get('x-request-id') ?? '',
      req.headers.get('x-vercel-id') ?? '',
      req.headers.get('user-agent') ?? '',
    ]
      .join('|')
      .slice(0, 512);
    const payloadHash = buildAckPayloadHash({
      siteId: siteUuid,
      kind: 'ACK_FAILED',
      queueIds,
      fatalErrorIds: fatalIds,
      errorCode,
      errorMessage,
      errorCategory: category,
    });
    const receipt = await registerAckReceipt({
      siteId: siteUuid,
      kind: 'ACK_FAILED',
      payloadHash,
      requestFingerprint,
      requestPayload: {
        queueIds,
        fatalErrorIds: fatalIds,
        errorCode,
        errorMessage,
        errorCategory: category,
      },
    });
    if (receipt.replayed) {
      if (receipt.resultSnapshot) {
        return NextResponse.json(receipt.resultSnapshot);
      }
      if (receipt.inProgress) {
        return NextResponse.json(
          { ok: false, code: 'ACK_FAILED_REPLAY_IN_PROGRESS', retryable: true },
          { status: 202 }
        );
      }
    }
    const nextRetryAt = addSecondsIso(now, 30);
    let updatedCount = 0;
    const deadLetterAuditEntries: Parameters<typeof insertDeadLetterAuditLogs>[0] = [];

    if (sealFailedIds.length > 0) {
      const { data: sealRows } = await adminClient
        .from('offline_conversion_queue')
        .select('id, call_id, attempt_count')
        .in('id', sealFailedIds)
        .eq('site_id', siteUuid)
        .eq('status', 'PROCESSING');

      const sealRowsList = Array.isArray(sealRows)
        ? sealRows as Array<{ id: string; call_id: string | null; attempt_count: number | null }>
        : [];
      if (sealRowsList.length !== sealFailedIds.length) {
        logError('OCI_ACK_FAILED_QUEUE_MISMATCH', { requested: sealFailedIds.length, eligible: sealRowsList.length });
        return NextResponse.json({ error: 'Queue rows not in PROCESSING state', code: 'QUEUE_STATE_MISMATCH' }, { status: 409 });
      }

      const retryableSealIds = sealRowsList
        .filter((row) => category === 'TRANSIENT' && (row.attempt_count ?? 0) < MAX_ATTEMPTS)
        .map((row) => row.id);
      const failedSealIds = sealRowsList
        .filter((row) => category !== 'TRANSIENT' && (row.attempt_count ?? 0) < MAX_ATTEMPTS)
        .map((row) => row.id);
      const deadLetterSealRows = sealRowsList.filter((row) => (row.attempt_count ?? 0) >= MAX_ATTEMPTS);

      if (retryableSealIds.length > 0) {
        const { data: batchCount, error: rpcError } = await adminClient.rpc('append_script_transition_batch', {
          p_queue_ids: retryableSealIds,
          p_new_status: 'RETRY',
          p_created_at: now,
          p_error_payload: {
            next_retry_at: nextRetryAt,
            last_error: errorMessage,
            provider_error_code: errorCode,
            provider_error_category: 'TRANSIENT',
            clear_fields: ['uploaded_at', 'claimed_at', 'provider_request_id', 'provider_ref'],
          },
        });
        if (rpcError || typeof batchCount !== 'number' || batchCount !== retryableSealIds.length) {
          logError('OCI_ACK_FAILED_RETRY_BATCH_RPC_FAILED', { code: (rpcError as { code?: string })?.code, requested: retryableSealIds.length, updated: batchCount });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
        updatedCount += batchCount;
      }

      if (failedSealIds.length > 0) {
        const { data: batchCount, error: rpcError } = await adminClient.rpc('append_script_transition_batch', {
          p_queue_ids: failedSealIds,
          p_new_status: 'FAILED',
          p_created_at: now,
          p_error_payload: {
            last_error: errorMessage,
            provider_error_code: errorCode,
            provider_error_category: category,
            clear_fields: ['next_retry_at', 'uploaded_at', 'claimed_at', 'provider_request_id', 'provider_ref'],
          },
        });
        if (rpcError || typeof batchCount !== 'number' || batchCount !== failedSealIds.length) {
          logError('OCI_ACK_FAILED_TERMINAL_BATCH_RPC_FAILED', { code: (rpcError as { code?: string })?.code, requested: failedSealIds.length, updated: batchCount });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
        updatedCount += batchCount;
      }

      if (deadLetterSealRows.length > 0) {
        const { data: batchCount, error: rpcError } = await adminClient.rpc('append_script_transition_batch', {
          p_queue_ids: deadLetterSealRows.map((row) => row.id),
          p_new_status: 'DEAD_LETTER_QUARANTINE',
          p_created_at: now,
          p_error_payload: {
            last_error: errorMessage,
            provider_error_code: errorCode,
            provider_error_category: 'PERMANENT',
            clear_fields: ['next_retry_at', 'uploaded_at', 'claimed_at', 'provider_request_id', 'provider_ref'],
          },
        });
        if (rpcError || typeof batchCount !== 'number' || batchCount !== deadLetterSealRows.length) {
          logError('OCI_ACK_FAILED_DEAD_LETTER_BATCH_RPC_FAILED', { code: (rpcError as { code?: string })?.code, requested: deadLetterSealRows.length, updated: batchCount });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
        updatedCount += batchCount;
        deadLetterAuditEntries.push(
          ...deadLetterSealRows.map((row) => ({
            siteId: siteUuid,
            resourceType: 'oci_queue' as const,
            resourceId: row.id,
            callId: row.call_id,
            errorCode,
            errorMessage,
            errorCategory: getAuditErrorCategory(category, true),
            attemptCount: row.attempt_count ?? MAX_ATTEMPTS,
            pipeline: 'SCRIPT' as const,
          }))
        );
      }
    }

    if (signalFailedIds.length > 0) {
      const nextStatus = category === 'TRANSIENT' ? 'PENDING' : 'FAILED';
      let updatedSignals = 0;
      try {
        updatedSignals = await applyMarketingSignalDispatchBatch(adminClient, {
          siteId: siteUuid,
          signalIds: signalFailedIds,
          expectStatus: 'PROCESSING',
          newStatus: nextStatus,
        });
      } catch (e) {
        logError('OCI_ACK_FAILED_SIGNAL_UPDATE', { error: e instanceof Error ? e.message : String(e) });
        return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
      }
      if (updatedSignals !== signalFailedIds.length) {
        logError('OCI_ACK_FAILED_SIGNAL_MISMATCH', { requested: signalFailedIds.length, updated: updatedSignals });
        return NextResponse.json({ error: 'Signal rows not in PROCESSING state', code: 'SIGNAL_STATE_MISMATCH' }, { status: 409 });
      }
      updatedCount += updatedSignals;
    }

    const allPvIds = [...new Set([...pvFailedIds, ...pvFatalIds])];
    if (allPvIds.length > 0) {
      const processingKeys = getPvProcessingKeysForCleanup(siteUuid, resolvedSite?.public_id ?? null);
      const queueKey = getPvQueueKey(siteUuid);
      const requeuePv = category === 'TRANSIENT' && pvFatalIds.length === 0;
      const redisResults = await Promise.allSettled(
        allPvIds.map(async (pvId) => {
          await Promise.all(processingKeys.map((processingKey) => redis.lrem(processingKey, 0, pvId)));
          if (requeuePv) {
            await redis.rpush(queueKey, pvId);
            return pvId;
          }
          await redis.del(getPvDataKey(pvId));
          return pvId;
        })
      );
      const updatedPvCount = redisResults.filter((result) => result.status === 'fulfilled').length;
      if (updatedPvCount !== allPvIds.length) {
        const failedPvIds = redisResults
          .map((result, index) => (result.status === 'rejected' ? allPvIds[index] : null))
          .filter((value): value is string => Boolean(value));
        logError('OCI_ACK_FAILED_PV_REDIS_MISMATCH', {
          requested: allPvIds.length,
          updated: updatedPvCount,
          failed_pv_ids: failedPvIds,
        });
        return NextResponse.json({ error: 'PV redis cleanup failed', code: 'PV_REDIS_MISMATCH' }, { status: 500 });
      }
      updatedCount += updatedPvCount;
    }

    // Explicit poison/fatal ids always hard-transition to dead letter.
    if (sealFatalIds.length > 0) {
      const { data: fatalRows } = await adminClient
        .from('offline_conversion_queue')
        .select('id, call_id, attempt_count')
        .in('id', sealFatalIds)
        .eq('site_id', siteUuid)
        .eq('status', 'PROCESSING');
      const fatalRowsList = Array.isArray(fatalRows)
        ? fatalRows as Array<{ id: string; call_id: string | null; attempt_count: number | null }>
        : [];
      if (fatalRowsList.length !== sealFatalIds.length) {
        logError('OCI_ACK_FAILED_FATAL_QUEUE_MISMATCH', { requested: sealFatalIds.length, eligible: fatalRowsList.length });
        return NextResponse.json({ error: 'Queue rows not in PROCESSING state', code: 'QUEUE_STATE_MISMATCH' }, { status: 409 });
      }
      const { data: batchCount, error: rpcError } = await adminClient.rpc('append_script_transition_batch', {
        p_queue_ids: fatalRowsList.map((row) => row.id),
        p_new_status: 'DEAD_LETTER_QUARANTINE',
        p_created_at: now,
        p_error_payload: {
          last_error: errorMessage,
          provider_error_code: errorCode,
          provider_error_category: 'PERMANENT',
          clear_fields: ['next_retry_at', 'uploaded_at', 'claimed_at', 'provider_request_id', 'provider_ref'],
        },
      });
      if (rpcError || typeof batchCount !== 'number' || batchCount !== fatalRowsList.length) {
        logError('OCI_ACK_FAILED_FATAL_BATCH_RPC_FAILED', { code: (rpcError as { code?: string })?.code, requested: fatalRowsList.length, updated: batchCount });
        return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
      }
      updatedCount += batchCount;
      deadLetterAuditEntries.push(
        ...fatalRowsList.map((row) => ({
          siteId: siteUuid,
          resourceType: 'oci_queue' as const,
          resourceId: row.id,
          callId: row.call_id,
          errorCode,
          errorMessage,
          errorCategory: getAuditErrorCategory(category, false),
          attemptCount: row.attempt_count ?? 0,
          pipeline: 'SCRIPT' as const,
        }))
      );
    }

    if (signalFatalIds.length > 0) {
      let fatalUpdated = 0;
      try {
        fatalUpdated = await applyMarketingSignalDispatchBatch(adminClient, {
          siteId: siteUuid,
          signalIds: signalFatalIds,
          expectStatus: 'PROCESSING',
          newStatus: 'DEAD_LETTER_QUARANTINE',
        });
      } catch (e) {
        logError('OCI_ACK_FAILED_FATAL_SIGNAL_UPDATE', { error: e instanceof Error ? e.message : String(e) });
        return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
      }
      if (fatalUpdated !== signalFatalIds.length) {
        logError('OCI_ACK_FAILED_FATAL_SIGNAL_MISMATCH', { requested: signalFatalIds.length, updated: fatalUpdated });
        return NextResponse.json({ error: 'Signal rows not in PROCESSING state', code: 'SIGNAL_STATE_MISMATCH' }, { status: 409 });
      }
      const { data: traceRows, error: traceErr } = await adminClient
        .from('marketing_signals')
        .select('id, trace_id')
        .in('id', signalFatalIds)
        .eq('site_id', siteUuid);
      if (traceErr) {
        logError('OCI_ACK_FAILED_FATAL_SIGNAL_TRACE_FETCH', { code: (traceErr as { code?: string })?.code });
        return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
      }
      const updatedRows = Array.isArray(traceRows)
        ? traceRows as Array<{ id: string; trace_id: string | null }>
        : [];
      updatedCount += fatalUpdated;
      deadLetterAuditEntries.push(
        ...updatedRows.map((row) => ({
          siteId: siteUuid,
          resourceType: 'marketing_signal' as const,
          resourceId: row.id,
          traceId: row.trace_id,
          errorCode,
          errorMessage,
          errorCategory: getAuditErrorCategory(category, false),
          attemptCount: 0,
          pipeline: 'SCRIPT' as const,
        }))
      );
    }

    if (deadLetterAuditEntries.length > 0) {
      await insertDeadLetterAuditLogs(deadLetterAuditEntries);
    }

    if (updatedCount > 0) {
      logInfo('OCI_ACK_FAILED_MARKED', {
        site_id: siteUuid,
        count: updatedCount,
        error_code: errorCode,
        error_category: category,
        retry_count: category === 'TRANSIENT' ? sealFailedIds.length + signalFailedIds.length : 0,
        fatal_count: fatalIds.length,
      });
    }

    const responsePayload = { ok: true, updated: updatedCount };
    if (receipt.receiptId) {
      await completeAckReceipt({
        receiptId: receipt.receiptId,
        resultSnapshot: responsePayload,
      });
      await appendRoutingHop({
        siteId: siteUuid,
        lane: 'ack_failed',
        unitId: receipt.receiptId,
        fromState: 'REGISTERED',
        toState: 'APPLIED',
        reasonCode: 'ACK_FAILED_COMPUTED',
        idempotencyKey: `ack_failed:${receipt.receiptId}`,
      });
    }
    return NextResponse.json(responsePayload);
  } catch (e: unknown) {
    logError('OCI_ACK_FAILED_ERROR', { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
  }
}
