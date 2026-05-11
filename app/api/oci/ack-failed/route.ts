/**
 * POST /api/oci/ack-failed — Script validation/upload fail sonrası: PROCESSING → FAILED/RETRY.
 *
 * Script validation (INVALID_TIME_FORMAT vb) veya upload red aldığında bu endpoint'i çağırır.
 * Satırlar FAILED olur, last_error yazılır; recover-processing bunlara dokunmaz.
 *
 * PR-9I.1: Does not downgrade terminal success (`COMPLETED` / `UPLOADED` / `COMPLETED_UNVERIFIED`).
 * Only `PROCESSING` (and TRANSIENT retry paths) are mutated. No post-claim live sendability masking.
 *
 * Body: { siteId: string, queueIds: string[], errorCode?: string, errorMessage?: string, errorCategory?: … }
 * errorCategory: `VALIDATION` | `TRANSIENT` | `AUTH` | `RATE_LIMIT` | `UNKNOWN`
 * Auth: Bearer session_token veya x-api-key (export/ack ile aynı).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { MAX_ATTEMPTS } from '@/lib/domain/oci/queue-types';
import { insertDeadLetterAuditLogs } from '@/lib/oci/dead-letter-audit';
import { redis } from '@/lib/upstash';
import { getPvDataKey, getPvProcessingKeysForCleanup, getPvQueueKey } from '@/lib/oci/pv-redis';
import { buildAckPayloadHash, completeAckReceipt, registerAckReceipt } from '@/lib/oci/ack-receipt';
import { nextRetryDelaySecondsWithJitter } from '@/lib/cron/process-offline-conversions';
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
  verifyTransitionCount,
} from '@/lib/oci/oci-ack-route-helpers';
import { splitAckPrefixedIds } from '@/lib/oci/ack-id-groups';
import { resolveOciScriptAuth } from '@/lib/oci/script-auth';
import { evaluateOciAckSignaturePolicy } from '@/lib/security/oci-ack-signature-policy';
import { isTerminalSuccessStatus } from '@/lib/oci/ack-finalization-policy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type AckFailedCategory = 'VALIDATION' | 'TRANSIENT' | 'AUTH' | 'RATE_LIMIT' | 'UNKNOWN';

function getAuditErrorCategory(category: AckFailedCategory, maxAttemptsHit: boolean): 'PERMANENT' | 'VALIDATION' | 'AUTH' | 'MAX_ATTEMPTS' {
  if (maxAttemptsHit) return 'MAX_ATTEMPTS';
  if (category === 'VALIDATION') return 'VALIDATION';
  if (category === 'AUTH' || category === 'RATE_LIMIT') return 'AUTH';
  if (category === 'UNKNOWN') return 'PERMANENT';
  return 'PERMANENT';
}

export async function POST(req: NextRequest) {
  const warnings: Record<string, unknown> = {};
  try {
    const lane = assertLaneActive('OCI_ACK');
    if (!lane.ok) {
      return NextResponse.json({ error: 'OCI ACK paused', code: lane.code }, { status: 503 });
    }
    const rawBody = await req.clone().text();

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
    const exportRunId = typeof body.export_run_id === 'string' ? body.export_run_id : typeof body.run_id === 'string' ? body.run_id : req.headers.get('x-opsmantik-export-run-id') || undefined;

    const auth = await resolveOciScriptAuth({
      req,
      siteIdFromBody,
      authFailNamespace: 'oci-ack-failed-authfail',
    });
    if (!auth.ok) return auth.response;
    const siteUuid = auth.siteUuid;
    const resolvedSite = auth.resolvedSite;

    const signatureDecision = await evaluateOciAckSignaturePolicy({
      signatureHeader: req.headers.get('x-oci-signature'),
      payload: rawBody,
      secret: resolvedSite.oci_api_key ?? undefined,
      requireSignatureEnv: process.env.OCI_ACK_REQUIRE_SIGNATURE,
    });
    if (!signatureDecision.ok) {
      logError('OCI_ACK_FAILED_SIGNATURE_POLICY_REJECT', {
        code: signatureDecision.code,
        reason: signatureDecision.reason,
        signature_required: signatureDecision.signature_required,
        site_id: siteUuid,
      });
      return NextResponse.json(
        { error: signatureDecision.reason, code: signatureDecision.code },
        { status: signatureDecision.status }
      );
    }
    const queueIds = sortDeterministicIds(coerced.queueIds);

    const fatalIds = sortDeterministicIds(coerced.fatalIds);

    const errorCode = coerced.errorCode || 'VALIDATION_FAILED';
    const errorMessage = coerced.errorMessage || errorCode;
    const rawCategory = typeof body.errorCategory === 'string' ? body.errorCategory : '';
    const category: AckFailedCategory = ['VALIDATION', 'TRANSIENT', 'AUTH', 'RATE_LIMIT', 'UNKNOWN'].includes(rawCategory)
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
    if (signalFailedIds.length > 0 || signalFatalIds.length > 0) {
      return NextResponse.json(
        { error: 'signal_* ACK_FAILED IDs are retired in queue-only mode', code: 'ACK_FAILED_SIGNAL_IDS_RETIRED' },
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
        exportRunId,
      },
    });

    if (exportRunId) {
      logInfo('EXPORT_RUN_ACK_FAILED_RECEIVED', { site_id: siteUuid, export_run_id: exportRunId, queue_ids: queueIds.length });
    } else {
      logInfo('EXPORT_RUN_ID_MISSING', { site_id: siteUuid });
    }

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
    let actualTransitionedCount = 0;
    let alreadyTerminalCount = 0;
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
      const terminalSuccessNoopCount = sealRowsList.filter((r) => isTerminalSuccessStatus(r.status)).length;
      if (terminalSuccessNoopCount > 0) {
        logInfo('OCI_ACK_FAILED_NOOP_ALREADY_SUCCESS_TERMINAL', {
          site_id: siteUuid,
          code: 'ACK_FAILED_NO_DOWNGRADE_ALREADY_COMPLETED',
          terminal_success_noop_count: terminalSuccessNoopCount,
        });
      }
      const bySealId = new Map(sealRowsList.map((r) => [r.id, r]));
      const missingSeals = sealFailedIds.filter((id) => !bySealId.has(id));
      if (missingSeals.length > 0) {
        logError('OCI_ACK_FAILED_MISSING_SEALS', { missingSeals });
        warnings.missing_seal_ids = missingSeals;
      }

      for (const id of sealFailedIds) {
        const row = bySealId.get(id);
        if (row && row.status !== 'PROCESSING') {
          alreadyTerminalCount += 1;
        }
      }

      const sealRowsProcessing = sealRowsList.filter((r) => r.status === 'PROCESSING');

      const retryableSealRows = sealRowsProcessing.filter(
        (row) => category === 'TRANSIENT' && (row.attempt_count ?? 0) < MAX_ATTEMPTS
      );
      const retryableSealIds = retryableSealRows.map((row) => row.id);
      const maxAttemptForBackoff =
        retryableSealRows.length > 0
          ? Math.max(...retryableSealRows.map((row) => row.attempt_count ?? 0))
          : 0;
      const nextRetryAt = addSecondsIso(now, nextRetryDelaySecondsWithJitter(maxAttemptForBackoff));
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
        actualTransitionedCount += batchCount;
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
        actualTransitionedCount += batchCount;
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
        actualTransitionedCount += batchCount;
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
      actualTransitionedCount += updatedPvCount;
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
          alreadyTerminalCount += 1;
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
        actualTransitionedCount += batchCount;
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


    if (deadLetterAuditEntries.length > 0) {
      try {
        await insertDeadLetterAuditLogs(deadLetterAuditEntries);
      } catch (auditErr) {
        logError('OCI_ACK_FAILED_AUDIT_APPEND', { error: auditErr instanceof Error ? auditErr.message : String(auditErr) });
        warnings.dead_letter_audit_append_failed = true;
      }
    }

    if (actualTransitionedCount > 0) {
      logInfo('OCI_ACK_FAILED_MARKED', {
        site_id: siteUuid,
        count: actualTransitionedCount,
        error_code: errorCode,
        error_category: category,
        retry_count: category === 'TRANSIENT' ? sealFailedIds.length : 0,
        fatal_count: fatalIds.length,
        dispatch_code: 'ACK_FAILED_DISPATCH_RECORDED',
      });
    }

    const responsePayload: {
      ok: boolean;
      updated: number;
      message?: string;
      warnings?: Record<string, unknown>;
      export_run_id?: string;
    } = {
      ok: true,
      updated: actualTransitionedCount + alreadyTerminalCount,
      export_run_id: exportRunId,
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

    const totalExpectedCount = new Set([...queueIds, ...fatalIds]).size;
    const verification = verifyTransitionCount({
      expectedCount: totalExpectedCount,
      transitionedCount: actualTransitionedCount,
      alreadyTerminalCount,
      exportRunId,
      route: 'ack_failed'
    });

    if (!verification.ok) {
      if (Object.keys(warnings).length > 0) {
        (verification.payload as Record<string, unknown>).warnings = warnings;
      }
      if (receipt.receiptId) {
        try {
          await completeAckReceipt({
            receiptId: receipt.receiptId,
            resultSnapshot: verification.payload as Record<string, unknown>,
          });
          await appendRoutingHop({
            siteId: siteUuid,
            lane: 'ack_failed',
            unitId: receipt.receiptId,
            fromState: 'REGISTERED',
            toState: 'APPLIED',
            reasonCode: 'ACK_FAILED_MISMATCH_COMPUTED',
            idempotencyKey: `ack_failed_mismatch:${receipt.receiptId}`,
          });
        } catch (e) {
          logError('OCI_ACK_FAILED_RECEIPT_LEDGER_MISMATCH_APPEND_FAILED', {
            receiptId: receipt.receiptId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      return NextResponse.json(verification.payload, { status: verification.isReplay ? 200 : 409 });
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
