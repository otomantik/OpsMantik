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
import { assertLaneActive } from '@/lib/oci/kill-switch';
import { logError, logInfo } from '@/lib/logging/logger';
import {
  coerceAckFailedFields,
  dbUpstreamResponse,
  isInfrastructurePostgrestError,
  normalizeAckFailedBody,
  reconcileSignalDispatchOutcome,
} from '@/lib/oci/oci-ack-route-helpers';
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
  const warnings: Record<string, unknown> = {};
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

    let bodyUnknown: unknown;
    try {
      bodyUnknown = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'BAD_REQUEST' }, { status: 400 });
    }
    if (Array.isArray(bodyUnknown)) {
      return NextResponse.json(
        { error: 'ACK_FAILED body must be a JSON object, not an array', code: 'BAD_REQUEST' },
        { status: 400 }
      );
    }
    const body = normalizeAckFailedBody(bodyUnknown);
    const coerced = coerceAckFailedFields(body);
    const siteIdFromBody = typeof body.siteId === 'string' ? body.siteId : undefined;
    const auth = await resolveOciScriptAuth({
      req,
      siteIdFromBody,
      authFailNamespace: 'oci-ack-failed-authfail',
    });
    if (!auth.ok) return auth.response;
    const siteUuid = auth.siteUuid;
    const resolvedSite = auth.resolvedSite;
    const queueIds = sortDeterministicIds(coerced.queueIds);

    const fatalIds = sortDeterministicIds(coerced.fatalIds);

    const errorCode = coerced.errorCode || 'VALIDATION_FAILED';
    const errorMessage = coerced.errorMessage || errorCode;
    const rawCategory = typeof body.errorCategory === 'string' ? body.errorCategory : '';
    const category: AckFailedCategory = ['VALIDATION', 'TRANSIENT', 'AUTH'].includes(rawCategory)
      ? (rawCategory as AckFailedCategory)
      : 'VALIDATION';

    if (queueIds.length === 0 && fatalIds.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    const {
      sealIds: sealFailedIds,
      signalIds: signalFailedIds,
      pvIds: pvFailedIds,
      unknownIds: unknownFailedIds,
    } = splitAckPrefixedIds(queueIds);
    const {
      sealIds: sealFatalIds,
      signalIds: signalFatalIds,
      pvIds: pvFatalIds,
      unknownIds: unknownFatalIds,
    } = splitAckPrefixedIds(fatalIds);
    if (unknownFailedIds.length > 0 || unknownFatalIds.length > 0) {
      return NextResponse.json(
        {
          error: 'Unknown ACK_FAILED id prefix',
          code: 'ACK_UNKNOWN_PREFIX',
          unknownIds: [...unknownFailedIds, ...unknownFatalIds],
        },
        { status: 400 }
      );
    }

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
      const { data: sealRows, error: sealFetchErr } = await adminClient
        .from('offline_conversion_queue')
        .select('id, status, call_id, attempt_count')
        .in('id', sealFailedIds)
        .eq('site_id', siteUuid);

      if (sealFetchErr) {
        return dbUpstreamResponse('OCI_ACK_FAILED_SEAL_FETCH', sealFetchErr, 'OCI_ACK_FAILED_SEAL_FETCH');
      }

      const sealRowsList = Array.isArray(sealRows)
        ? (sealRows as Array<{ id: string; status: string; call_id: string | null; attempt_count: number | null }>)
        : [];
      const bySealId = new Map(sealRowsList.map((r) => [r.id, r]));
      const missingSeals = sealFailedIds.filter((id) => !bySealId.has(id));
      if (missingSeals.length > 0) {
        logError('OCI_ACK_FAILED_MISSING_SEALS', { missingSeals });
        warnings.missing_seal_ids = missingSeals;
      }

      for (const id of sealFailedIds) {
        const row = bySealId.get(id);
        if (row && row.status !== 'PROCESSING') {
          updatedCount += 1;
        }
      }

      const sealRowsProcessing = sealRowsList.filter((r) => r.status === 'PROCESSING');

      const retryableSealIds = sealRowsProcessing
        .filter((row) => category === 'TRANSIENT' && (row.attempt_count ?? 0) < MAX_ATTEMPTS)
        .map((row) => row.id);
      const failedSealIds = sealRowsProcessing
        .filter((row) => category !== 'TRANSIENT' && (row.attempt_count ?? 0) < MAX_ATTEMPTS)
        .map((row) => row.id);
      const deadLetterSealRows = sealRowsProcessing.filter((row) => (row.attempt_count ?? 0) >= MAX_ATTEMPTS);

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
          return dbUpstreamResponse(
            'OCI_ACK_FAILED_RETRY_BATCH_RPC_FAILED',
            rpcError ?? new Error('retry batch mismatch'),
            'OCI_ACK_FAILED_RETRY_BATCH_RPC_FAILED'
          );
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
          return dbUpstreamResponse(
            'OCI_ACK_FAILED_TERMINAL_BATCH_RPC_FAILED',
            rpcError ?? new Error('failed batch mismatch'),
            'OCI_ACK_FAILED_TERMINAL_BATCH_RPC_FAILED'
          );
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
          return dbUpstreamResponse(
            'OCI_ACK_FAILED_DEAD_LETTER_BATCH_RPC_FAILED',
            rpcError ?? new Error('dead letter batch mismatch'),
            'OCI_ACK_FAILED_DEAD_LETTER_BATCH_RPC_FAILED'
          );
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
      const recon = await reconcileSignalDispatchOutcome(adminClient, {
        siteId: siteUuid,
        signalIds: signalFailedIds,
        expectStatus: 'PROCESSING',
        newStatus: nextStatus,
      });
      for (const id of signalFailedIds) {
        const st = recon.rowsSnapshot.get(id);
        if (st !== undefined && st !== 'PROCESSING') {
          updatedCount += 1;
        }
      }
      if (recon.missingIds.length > 0) {
        warnings.failed_missing_signal_ids = recon.missingIds;
      }
      if (recon.stuckProcessingIds.length > 0) {
        logError('OCI_ACK_FAILED_SIGNAL_STILL_PROCESSING', {
          ids: recon.stuckProcessingIds,
          rpcApplied: recon.rpcApplied,
          nextStatus,
        });
        warnings.signals_still_processing = recon.stuckProcessingIds;
      }
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
        logError('OCI_ACK_FAILED_PV_REDIS_PARTIAL', {
          requested: allPvIds.length,
          updated: updatedPvCount,
          failed_pv_ids: failedPvIds,
        });
        warnings.pv_redis_partial = failedPvIds;
      }
      updatedCount += updatedPvCount;
    }

    // Explicit poison/fatal ids always hard-transition to dead letter.
    if (sealFatalIds.length > 0) {
      const { data: fatalRows, error: fatalFetchErr } = await adminClient
        .from('offline_conversion_queue')
        .select('id, status, call_id, attempt_count')
        .in('id', sealFatalIds)
        .eq('site_id', siteUuid);

      if (fatalFetchErr) {
        return dbUpstreamResponse('OCI_ACK_FAILED_FATAL_SEAL_FETCH', fatalFetchErr, 'OCI_ACK_FAILED_FATAL_SEAL_FETCH');
      }

      const fatalAll = Array.isArray(fatalRows)
        ? (fatalRows as Array<{ id: string; status: string; call_id: string | null; attempt_count: number | null }>)
        : [];
      const byFatalSeal = new Map(fatalAll.map((r) => [r.id, r]));
      const missingFatalSeal = sealFatalIds.filter((id) => !byFatalSeal.has(id));
      if (missingFatalSeal.length > 0) {
        warnings.missing_fatal_seal_ids = missingFatalSeal;
      }

      for (const id of sealFatalIds) {
        const row = byFatalSeal.get(id);
        if (row && row.status !== 'PROCESSING') {
          updatedCount += 1;
        }
      }

      const fatalRowsProcessing = fatalAll.filter((r) => r.status === 'PROCESSING');
      if (fatalRowsProcessing.length > 0) {
        const { data: batchCount, error: rpcError } = await adminClient.rpc('append_script_transition_batch', {
          p_queue_ids: fatalRowsProcessing.map((row) => row.id),
          p_new_status: 'DEAD_LETTER_QUARANTINE',
          p_created_at: now,
          p_error_payload: {
            last_error: errorMessage,
            provider_error_code: errorCode,
            provider_error_category: 'PERMANENT',
            clear_fields: ['next_retry_at', 'uploaded_at', 'claimed_at', 'provider_request_id', 'provider_ref'],
          },
        });
        if (rpcError || typeof batchCount !== 'number' || batchCount !== fatalRowsProcessing.length) {
          return dbUpstreamResponse(
            'OCI_ACK_FAILED_FATAL_BATCH_RPC_FAILED',
            rpcError ?? new Error('fatal seal batch mismatch'),
            'OCI_ACK_FAILED_FATAL_BATCH_RPC_FAILED'
          );
        }
        updatedCount += batchCount;
        deadLetterAuditEntries.push(
          ...fatalRowsProcessing.map((row) => ({
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
    }

    if (signalFatalIds.length > 0) {
      const reconFatalSig = await reconcileSignalDispatchOutcome(adminClient, {
        siteId: siteUuid,
        signalIds: signalFatalIds,
        expectStatus: 'PROCESSING',
        newStatus: 'DEAD_LETTER_QUARANTINE',
      });

      for (const id of signalFatalIds) {
        const st = reconFatalSig.rowsSnapshot.get(id);
        if (st !== undefined && st !== 'PROCESSING') {
          updatedCount += 1;
        }
      }
      if (reconFatalSig.missingIds.length > 0) {
        warnings.fatal_missing_signal_ids = reconFatalSig.missingIds;
      }
      if (reconFatalSig.stuckProcessingIds.length > 0) {
        logError('OCI_ACK_FAILED_FATAL_SIGNAL_STILL_PROCESSING', {
          ids: reconFatalSig.stuckProcessingIds,
          rpcApplied: reconFatalSig.rpcApplied,
        });
        warnings.fatal_signals_still_processing = reconFatalSig.stuckProcessingIds;
      }

      const { data: traceRows, error: traceErr } = await adminClient
        .from('marketing_signals')
        .select('id, trace_id')
        .in('id', signalFatalIds)
        .eq('site_id', siteUuid);
      if (traceErr) {
        warnings.fatal_signal_trace_fetch = traceErr.message;
        logError('OCI_ACK_FAILED_FATAL_SIGNAL_TRACE_FETCH', { code: (traceErr as { code?: string })?.code });
      } else {
        const updatedRows = Array.isArray(traceRows)
          ? traceRows as Array<{ id: string; trace_id: string | null }>
          : [];
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
    }

    if (deadLetterAuditEntries.length > 0) {
      try {
        await insertDeadLetterAuditLogs(deadLetterAuditEntries);
      } catch (auditErr) {
        logError('OCI_ACK_FAILED_AUDIT_APPEND', { error: auditErr instanceof Error ? auditErr.message : String(auditErr) });
        warnings.dead_letter_audit_append_failed = true;
      }
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

    const responsePayload: {
      ok: boolean;
      updated: number;
      message?: string;
      warnings?: Record<string, unknown>;
    } = {
      ok: true,
      updated: updatedCount,
      ...(Object.keys(warnings).length > 0 ? { message: 'ACK_FAILED completed with warnings', warnings } : {}),
    };

    if (receipt.receiptId) {
      try {
        await completeAckReceipt({
          receiptId: receipt.receiptId,
          resultSnapshot: responsePayload as Record<string, unknown>,
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
      } catch (ledgerErr) {
        logError('OCI_ACK_FAILED_RECEIPT_LEDGER_APPEND_FAILED', {
          receiptId: receipt.receiptId,
          error: ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr),
        });
        responsePayload.warnings = { ...(responsePayload.warnings ?? {}), receipt_persist_warning: true };
      }
    }
    return NextResponse.json(responsePayload);
  } catch (e: unknown) {
    logError('OCI_ACK_FAILED_ERROR', { error: e instanceof Error ? e.message : String(e) });
    if (isInfrastructurePostgrestError(e)) {
      return dbUpstreamResponse('OCI_ACK_FAILED_UNHANDLED_INFRA', e, 'OCI_ACK_FAILED_UNHANDLED');
    }
    return NextResponse.json(
      { error: 'ACK_FAILED request could not be processed', code: 'ACK_FAILED_PROCESSING_ERROR', retryable: true },
      { status: 503 }
    );
  }
}
