/**
 * POST /api/oci/ack — Script yükleme sonrası: Google'a giden kayıtları onaylar.
 *
 * Tri-Pipeline: Script queueIds'leri seal_, pv_ prefix'i ile gönderir.
 * - seal_* → offline_conversion_queue (status=COMPLETED or UPLOADED; see pendingConfirmation)
 * - pv_* → Redis: DEL pv:data:{id}, LREM pv:processing:{siteId}
 *
 * Body:
 * - Legacy: { siteId: string, queueIds: string[], skippedIds?: string[], pendingConfirmation?: boolean }
 * - Granular: { siteId: string, results: [{ id: string, status: 'SUCCESS'|'FAILED', reason?: string }], pendingConfirmation?: boolean }
 * - pendingConfirmation=true: AdsApp bulk upload is asynchronous; mark seal_* as UPLOADED (not COMPLETED).
 * - providerConfirmationMode=bulk_upload_async_unconfirmed: same as pendingConfirmation=true (Google Ads Script lane).
 *   Row-level errors cannot be fetched via Scripts — check Google Ads UI > Tools > Uploads.
 * - pendingConfirmation=false or omitted: Mark as COMPLETED (API path or explicit confirmation).
 * skippedIds: DETERMINISTIC_SKIP (V1 sampled out). seal_* → COMPLETED + provider_error_code=V1_SAMPLED_OUT.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { redis } from '@/lib/upstash';
import { getPvDataKey, getPvProcessingKeysForCleanup } from '@/lib/oci/pv-redis';
import {
  ACK_SUCCESS_POLICY_CODES,
  aggregateAckSealSuccessRows,
  mapAckFinalizationTallyToObservability,
  type AckFinalizationCode,
} from '@/lib/oci/ack-finalization-policy';
import { logError, logInfo } from '@/lib/logging/logger';
import { buildAckPayloadHash, completeAckReceipt, registerAckReceipt } from '@/lib/oci/ack-receipt';
import { sortDeterministicIds } from '@/lib/oci/deterministic-scheduler';
import { appendRoutingHop } from '@/lib/oci/routing-ledger';
import { assertLaneActive } from '@/lib/oci/kill-switch';
import { splitAckPrefixedIds } from '@/lib/oci/ack-id-groups';
import { resolveOciScriptAuth } from '@/lib/oci/script-auth';
import {
  dbUpstreamResponse,
  isInfrastructurePostgrestError,
  parseAckJsonEnvelope,
  promoteSingleGranularResult,
  verifyTransitionCount,
  resolveScriptAckPendingConfirmation,
} from '@/lib/oci/oci-ack-route-helpers';
import { getDbNowIso } from '@/lib/time/db-now';
import { evaluateOciAckSignaturePolicy } from '@/lib/security/oci-ack-signature-policy';
import { resolveAckProjAdjTargetsForSuccess } from '@/lib/oci/ack-proj-adj-guard';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const warnings: Record<string, unknown> = {};
  try {
    const lane = assertLaneActive('OCI_ACK');
    if (!lane.ok) {
      return NextResponse.json({ error: 'OCI ACK paused', code: lane.code }, { status: 503 });
    }

    const rawBody = await req.text();
    let bodyUnknown: unknown;
    try {
      bodyUnknown = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'BAD_REQUEST' }, { status: 400 });
    }

    const parsed = parseAckJsonEnvelope(bodyUnknown);
    if (!parsed.ok) {
      if (parsed.reason === 'schema_violation') {
        return NextResponse.json(
          {
            error: 'Invalid ACK payload',
            code: 'ACK_SCHEMA_VIOLATION',
            issues: parsed.issues,
          },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: 'Body must be a JSON object or granular results array', code: 'BAD_REQUEST' },
        { status: 400 }
      );
    }
    const body = promoteSingleGranularResult(parsed.body);
    const siteIdFromBody = typeof body.siteId === 'string' ? body.siteId : undefined;
    const exportRunId = typeof body.export_run_id === 'string' ? body.export_run_id : typeof body.run_id === 'string' ? body.run_id : req.headers.get('x-opsmantik-export-run-id') || undefined;

    const auth = await resolveOciScriptAuth({
      req,
      siteIdFromBody,
      authFailNamespace: 'oci-ack-authfail',
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
      logError('OCI_ACK_SIGNATURE_POLICY_REJECT', {
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
    if (!req.headers.get('x-oci-signature')) {
      logInfo('OCI_ACK_SIMPLE_AUTH', {
        msg: 'No crypto signature; proceeding with API Key validation.',
        signature_required: signatureDecision.signature_required,
        site_id: siteUuid,
      });
    }
    const rawResults = Array.isArray(body.results) ? body.results : [];
    const granularResults = rawResults
      .filter((r): r is { id: string; status: 'SUCCESS' | 'FAILED'; reason?: string } => {
        if (!r || typeof r !== 'object') return false;
        const rec = r as Record<string, unknown>;
        return typeof rec.id === 'string' && (rec.status === 'SUCCESS' || rec.status === 'FAILED');
      })
      .map((r) => ({
        id: r.id,
        status: r.status,
        reason: typeof r.reason === 'string' ? r.reason.slice(0, 128) : null,
      }));

    const rawIds = Array.isArray(body.queueIds) ? body.queueIds : [];
    const successIdsFromResults = granularResults.filter((r) => r.status === 'SUCCESS').map((r) => r.id);
    const queueIds = sortDeterministicIds(
      [...rawIds, ...successIdsFromResults].filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    );
    const rawSkipped = Array.isArray(body.skippedIds) ? body.skippedIds : [];
    const skippedIds = sortDeterministicIds(
      rawSkipped.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    );
    const pendingConfirmation = resolveScriptAckPendingConfirmation(body);
    const providerConfirmationMode =
      typeof body.providerConfirmationMode === 'string' ? body.providerConfirmationMode : null;

    if (queueIds.length === 0 && skippedIds.length === 0 && granularResults.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    const {
      sealIds,
      signalIds,
      pvIds,
      projIds, // call_funnel_projection rows (proj_ prefix)
      adjIds, // conversion_adjustments rows (adj_ prefix)
      unknownIds,
    } = splitAckPrefixedIds(queueIds);
    if (unknownIds.length > 0) {
      return NextResponse.json({ error: 'Unknown ACK id prefix', code: 'ACK_UNKNOWN_PREFIX', unknownIds }, { status: 400 });
    }
    const sealSkippedIds: string[] = [];
    const pvSkippedIds: string[] = [];
    const unknownSkippedIds: string[] = [];
    for (const id of skippedIds) {
      const s = String(id);
      if (s.startsWith('seal_')) sealSkippedIds.push(s.slice(5));
      else if (s.startsWith('pv_')) pvSkippedIds.push(s.slice(3));
      else unknownSkippedIds.push(s);
    }
    if (unknownSkippedIds.length > 0) {
      return NextResponse.json(
        { error: 'Unknown ACK skipped id prefix', code: 'ACK_UNKNOWN_PREFIX', unknownIds: unknownSkippedIds },
        { status: 400 }
      );
    }
    if (signalIds.length > 0) {
      return NextResponse.json(
        { error: 'signal_* ACK IDs are retired in queue-only mode', code: 'ACK_SIGNAL_IDS_RETIRED' },
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
      kind: 'ACK',
      queueIds,
      skippedIds,
      results: granularResults,
      pendingConfirmation,
      providerConfirmationMode,
    });
    const receipt = await registerAckReceipt({
      siteId: siteUuid,
      kind: 'ACK',
      payloadHash,
      requestFingerprint,
      requestPayload: {
        queueIds,
        skippedIds,
        pendingConfirmation,
        providerConfirmationMode,
        results: granularResults,
        exportRunId,
      },
    });

    if (exportRunId) {
      logInfo('EXPORT_RUN_ACK_RECEIVED', { site_id: siteUuid, export_run_id: exportRunId, queue_ids: queueIds.length });
    } else {
      logInfo('EXPORT_RUN_ID_MISSING', { site_id: siteUuid });
    }

    if (receipt.replayed) {
      if (receipt.resultSnapshot) {
        const snap = receipt.resultSnapshot as Record<string, unknown> & { _ack_http_status?: number };
        const { _ack_http_status, ...rest } = snap;
        const status = typeof _ack_http_status === 'number' ? _ack_http_status : 200;
        return NextResponse.json(rest, { status });
      }
      if (receipt.inProgress) {
        return NextResponse.json(
          { ok: false, code: 'ACK_REPLAY_IN_PROGRESS', retryable: true },
          { status: 202 }
        );
      }
    }

    type ProjAdjTargets = { projectionRowIds: string[]; adjustmentIds: string[] };
    let projAdjTargets: ProjAdjTargets | null = null;
    if (projIds.length > 0 || adjIds.length > 0) {
      const guardResult = await resolveAckProjAdjTargetsForSuccess({
        admin: adminClient,
        siteId: siteUuid,
        projCallIds: projIds,
        adjIds,
      });
      if (!guardResult.ok) {
        const code = typeof guardResult.body.code === 'string' ? guardResult.body.code : '';
        if (code === 'ACK_PROJECTION_TARGET_MISMATCH') {
          incrementRefactorMetric('oci_ack_projection_target_mismatch_total');
        } else if (code === 'ACK_ADJUSTMENT_TARGET_MISMATCH') {
          incrementRefactorMetric('oci_ack_adjustment_target_mismatch_total');
        }
        const snap: Record<string, unknown> = { ...guardResult.body, ok: false, _ack_http_status: 409 };
        if (receipt.receiptId) {
          try {
            await completeAckReceipt({
              receiptId: receipt.receiptId,
              siteId: siteUuid,
              resultSnapshot: snap,
            });
            await appendRoutingHop({
              siteId: siteUuid,
              lane: 'ack',
              unitId: receipt.receiptId,
              fromState: 'REGISTERED',
              toState: 'APPLIED',
              reasonCode: 'ACK_PROJ_ADJ_TARGET_MISMATCH',
              idempotencyKey: `ack_proj_adj_guard:${receipt.receiptId}`,
            });
          } catch (ledgerErr) {
            logError('OCI_ACK_RECEIPT_LEDGER_APPEND_FAILED', {
              receiptId: receipt.receiptId,
              error: ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr),
            });
          }
        }
        return NextResponse.json(guardResult.body, { status: guardResult.status });
      }
      projAdjTargets = guardResult;
    }

    let actualTransitionedCount = 0;
    let alreadyTerminalCount = 0;
    let sealAckFinalizationTally: Partial<Record<AckFinalizationCode, number>> | undefined;

    // Idempotent ack logic: rows already in a terminal state (COMPLETED, UPLOADED) count
    // as already-acked and are returned as successes. Only rows in genuinely unexpected
    // states (QUEUED, RETRY, VOIDED_BY_REVERSAL, FAILED, or not found) produce warnings.
    // This makes the ack operation safe to retry after a network cut mid-response.
    const TERMINAL_STATES = ['COMPLETED', 'UPLOADED', 'COMPLETED_UNVERIFIED'];

    if (sealIds.length > 0) {
      const { data, error } = await adminClient
        .from('offline_conversion_queue')
        .select('id, status')
        .in('id', sealIds)
        .eq('site_id', siteUuid);

      if (error) {
        return dbUpstreamResponse('OCI_ACK_SQL_ERROR', error, 'OCI_ACK_SQL_ERROR');
      }
      const allRows = Array.isArray(data) ? (data as Array<{ id: string; status: string }>) : [];
      const sealFound = new Set(allRows.map((r) => r.id));
      const missingSealIds = sealIds.filter((id) => !sealFound.has(id));
      if (missingSealIds.length > 0) {
        logError('OCI_ACK_SEAL_PARTIAL_MISSING', { requested: sealIds.length, found: allRows.length, missing_seal_count: missingSealIds.length });
        warnings.missing_seal_ids = missingSealIds;
      }
      const alreadyDone = allRows.filter((r) => TERMINAL_STATES.includes(r.status));
      const unexpected = allRows.filter((r) => !TERMINAL_STATES.includes(r.status) && r.status !== 'PROCESSING');

      const agg = aggregateAckSealSuccessRows(allRows);
      sealAckFinalizationTally = { ...agg.tally };
      const toFinalizeIds = agg.finalizeIds;
      const observabilityTally = mapAckFinalizationTallyToObservability(agg.tally);

      if (unexpected.length > 0) {
        logError('OCI_ACK_UNEXPECTED_STATE', { unexpected_count: unexpected.length, states_sample: unexpected.slice(0, 5).map((r) => r.status) });
      }
      if (alreadyDone.length > 0) {
        logInfo('OCI_ACK_IDEMPOTENT_SKIP', { already_done: alreadyDone.length, requested: sealIds.length });
      }
      if (toFinalizeIds.length > 0) {
        logInfo('OCI_ACK_SUCCESS_FINALIZE_POLICY', {
          site_id: siteUuid,
          policy: ACK_SUCCESS_POLICY_CODES.NOT_BLOCKED_BY_POST_CLAIM_SENDABILITY,
          finalized_claimed_row_count: observabilityTally.ACK_SUCCESS_FINALIZED_CLAIMED_ROW,
          code: 'ACK_SUCCESS_FINALIZED_CLAIMED_ROW',
        });
      }
      alreadyTerminalCount += alreadyDone.length;

      if (toFinalizeIds.length > 0) {
        const clearFields = ['last_error', 'provider_error_code', 'provider_error_category', 'next_retry_at', 'claimed_at', 'provider_request_id', 'provider_ref'];
        const { data: updatedCount, error: rpcError } = await adminClient.rpc('append_script_transition_batch', {
          p_queue_ids: toFinalizeIds,
          p_new_status: pendingConfirmation ? 'UPLOADED' : 'COMPLETED',
          p_created_at: now,
          p_error_payload: { uploaded_at: now, clear_fields: clearFields },
        });
        if (rpcError || typeof updatedCount !== 'number') {
          return dbUpstreamResponse(
            'OCI_ACK_BATCH_RPC_FAILED',
            rpcError ?? new Error('append_script_transition_batch returned non-number'),
            'OCI_ACK_BATCH_RPC_FAILED'
          );
        }
        if (toFinalizeIds.length > 0 && updatedCount !== toFinalizeIds.length) {
          logError('OCI_ACK_FINALIZE_TRANSITION_COUNT_MISMATCH', {
            site_id: siteUuid,
            expected: toFinalizeIds.length,
            transitioned: updatedCount,
            export_run_id: exportRunId,
          });
          const snap = {
            ok: false,
            code: 'ACK_FINALIZE_TRANSITION_COUNT_MISMATCH',
            expected_count: toFinalizeIds.length,
            transitioned_count: updatedCount,
            export_run_id: exportRunId,
            _ack_http_status: 409,
          };
          if (receipt.receiptId) {
            try {
              await completeAckReceipt({
                receiptId: receipt.receiptId,
                siteId: siteUuid,
                resultSnapshot: snap as Record<string, unknown>,
              });
              await appendRoutingHop({
                siteId: siteUuid,
                lane: 'ack',
                unitId: receipt.receiptId,
                fromState: 'REGISTERED',
                toState: 'APPLIED',
                reasonCode: 'ACK_FINALIZE_BATCH_MISMATCH',
                idempotencyKey: `ack_finalize_mismatch:${receipt.receiptId}`,
              });
            } catch (ledgerErr) {
              logError('OCI_ACK_RECEIPT_LEDGER_APPEND_FAILED', {
                receiptId: receipt.receiptId,
                error: ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr),
              });
            }
          }
          return NextResponse.json(
            {
              status: 'PARTIAL_FAIL',
              reason: 'ACK_FINALIZE_TRANSITION_COUNT_MISMATCH',
              ...snap,
            },
            { status: 409 }
          );
        }
        actualTransitionedCount += updatedCount;
      }
    }

    const failedGranularIds = granularResults.filter((r) => r.status === 'FAILED').map((r) => r.id);
    if (failedGranularIds.length > 0) {
      const failedReasonById = new Map(granularResults.filter((r) => r.status === 'FAILED').map((r) => [r.id, r.reason]));
      const {
        sealIds: sealFailedIdsRaw,
        signalIds: signalFailedIdsRaw,
        unknownIds: unknownFailedIds,
      } = splitAckPrefixedIds(failedGranularIds);
      if (unknownFailedIds.length > 0) {
        return NextResponse.json(
          { error: 'Unknown ACK result id prefix', code: 'ACK_UNKNOWN_PREFIX', unknownIds: unknownFailedIds },
          { status: 400 }
        );
      }
      const sealFailedIds = sealFailedIdsRaw.map((id) => id.trim()).filter(Boolean);
      const signalFailedIds = signalFailedIdsRaw.map((id) => id.trim()).filter(Boolean);
      if (signalFailedIds.length > 0) {
        return NextResponse.json(
          { error: 'signal_* granular result IDs are retired in queue-only mode', code: 'ACK_SIGNAL_IDS_RETIRED' },
          { status: 400 }
        );
      }

      if (sealFailedIds.length > 0) {
        const { data: rows, error } = await adminClient
          .from('offline_conversion_queue')
          .select('id, status')
          .in('id', sealFailedIds)
          .eq('site_id', siteUuid);
        if (error) {
          return dbUpstreamResponse('OCI_ACK_GRANULAR_FAILED_SQL_ERROR', error, 'OCI_ACK_GRANULAR_FAILED_SQL_ERROR');
        }
        const processingRows = (rows ?? []).filter((row) => (row as { status?: string }).status === 'PROCESSING') as Array<{ id: string }>;
        const alreadyDone = (rows ?? []).filter((row) => (row as { status?: string }).status !== 'PROCESSING');
        alreadyTerminalCount += alreadyDone.length;
        if (processingRows.length > 0) {
          const payload = {
            provider_error_code: 'SCRIPT_ROW_FAILED',
            provider_error_category: 'VALIDATION',
            last_error: 'SCRIPT_ROW_FAILED',
            clear_fields: ['next_retry_at', 'uploaded_at', 'claimed_at', 'provider_request_id', 'provider_ref'],
          };
          const { data: updatedCount, error: rpcError } = await adminClient.rpc('append_script_transition_batch', {
            p_queue_ids: processingRows.map((r) => r.id),
            p_new_status: 'FAILED',
            p_created_at: now,
            p_error_payload: payload,
          });
          if (rpcError || typeof updatedCount !== 'number') {
            return dbUpstreamResponse(
              'OCI_ACK_GRANULAR_FAILED_BATCH_RPC_FAILED',
              rpcError ?? new Error('granular failed batch RPC'),
              'OCI_ACK_GRANULAR_FAILED_BATCH_RPC_FAILED'
            );
          }
          if (processingRows.length > 0 && updatedCount !== processingRows.length) {
            logError('OCI_ACK_GRANULAR_FAILED_BATCH_MISMATCH', {
              site_id: siteUuid,
              expected: processingRows.length,
              transitioned: updatedCount,
            });
            const snap = {
              ok: false,
              code: 'ACK_GRANULAR_FAILED_TRANSITION_COUNT_MISMATCH',
              expected_count: processingRows.length,
              transitioned_count: updatedCount,
              _ack_http_status: 409,
            };
            if (receipt.receiptId) {
              try {
                await completeAckReceipt({
                  receiptId: receipt.receiptId,
                  siteId: siteUuid,
                  resultSnapshot: snap as Record<string, unknown>,
                });
                await appendRoutingHop({
                  siteId: siteUuid,
                  lane: 'ack',
                  unitId: receipt.receiptId,
                  fromState: 'REGISTERED',
                  toState: 'APPLIED',
                  reasonCode: 'ACK_GRANULAR_FAILED_BATCH_MISMATCH',
                  idempotencyKey: `ack_granular_failed_mismatch:${receipt.receiptId}`,
                });
              } catch (ledgerErr) {
                logError('OCI_ACK_RECEIPT_LEDGER_APPEND_FAILED', {
                  receiptId: receipt.receiptId,
                  error: ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr),
                });
              }
            }
            return NextResponse.json(
              { status: 'PARTIAL_FAIL', reason: 'ACK_GRANULAR_FAILED_TRANSITION_COUNT_MISMATCH', ...snap },
              { status: 409 }
            );
          }
          actualTransitionedCount += updatedCount;
          for (const r of processingRows) {
            const key = `seal_${r.id}`;
            const reason = failedReasonById.get(key);
            if (reason) {
              logInfo('OCI_ACK_GRANULAR_ROW_FAILED', { site_id: siteUuid, queue_id: r.id, reason });
            }
          }
        }
      }

    }

    if (sealSkippedIds.length > 0) {
      const { data, error } = await adminClient
        .from('offline_conversion_queue')
        .select('id, status')
        .in('id', sealSkippedIds)
        .eq('site_id', siteUuid);

      if (error) {
        return dbUpstreamResponse('OCI_ACK_SKIPPED_SQL_ERROR', error, 'OCI_ACK_SKIPPED_SQL_ERROR');
      }
      const allRows = Array.isArray(data) ? data as Array<{ id: string; status: string }> : [];
      const alreadyDone = allRows.filter(r => TERMINAL_STATES.includes(r.status));
      const toTransition = allRows.filter(r => r.status === 'PROCESSING');

      alreadyTerminalCount += alreadyDone.length;

      if (toTransition.length > 0) {
        const { data: updatedCount, error: rpcError } = await adminClient.rpc('append_script_transition_batch', {
          p_queue_ids: toTransition.map((row) => row.id),
          p_new_status: 'COMPLETED',
          p_created_at: now,
          p_error_payload: {
            uploaded_at: now,
            provider_error_code: 'V1_SAMPLED_OUT',
            provider_error_category: 'DETERMINISTIC_SKIP',
            clear_fields: ['last_error', 'next_retry_at', 'claimed_at', 'provider_request_id', 'provider_ref'],
          },
        });
        if (rpcError || typeof updatedCount !== 'number') {
          return dbUpstreamResponse(
            'OCI_ACK_SKIPPED_BATCH_RPC_FAILED',
            rpcError ?? new Error('skipped batch RPC'),
            'OCI_ACK_SKIPPED_BATCH_RPC_FAILED'
          );
        }
        if (toTransition.length > 0 && updatedCount !== toTransition.length) {
          logError('OCI_ACK_SKIPPED_BATCH_MISMATCH', {
            site_id: siteUuid,
            expected: toTransition.length,
            transitioned: updatedCount,
          });
          const snap = {
            ok: false,
            code: 'ACK_SKIPPED_TRANSITION_COUNT_MISMATCH',
            expected_count: toTransition.length,
            transitioned_count: updatedCount,
            _ack_http_status: 409,
          };
          if (receipt.receiptId) {
            try {
              await completeAckReceipt({
                receiptId: receipt.receiptId,
                siteId: siteUuid,
                resultSnapshot: snap as Record<string, unknown>,
              });
              await appendRoutingHop({
                siteId: siteUuid,
                lane: 'ack',
                unitId: receipt.receiptId,
                fromState: 'REGISTERED',
                toState: 'APPLIED',
                reasonCode: 'ACK_SKIPPED_BATCH_MISMATCH',
                idempotencyKey: `ack_skipped_mismatch:${receipt.receiptId}`,
              });
            } catch (ledgerErr) {
              logError('OCI_ACK_RECEIPT_LEDGER_APPEND_FAILED', {
                receiptId: receipt.receiptId,
                error: ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr),
              });
            }
          }
          return NextResponse.json(
            { status: 'PARTIAL_FAIL', reason: 'ACK_SKIPPED_TRANSITION_COUNT_MISMATCH', ...snap },
            { status: 409 }
          );
        }
        actualTransitionedCount += updatedCount;
      }
    }

    // ── proj_ prefix: call_funnel_projection rows (strict READY → EXPORTED/UPLOADED) ──
    if (projAdjTargets && projAdjTargets.projectionRowIds.length > 0) {
      const projPkIds = projAdjTargets.projectionRowIds;
      const { data: updatedProjRows, error: projError } = await adminClient
        .from('call_funnel_projection')
        .update({ export_status: pendingConfirmation ? 'UPLOADED' : 'EXPORTED', updated_at: now })
        .in('id', projPkIds)
        .eq('site_id', siteUuid)
        .eq('export_status', 'READY')
        .select('id');

      if (projError) {
        return dbUpstreamResponse('OCI_ACK_PROJ_ERROR', projError, 'OCI_ACK_PROJ_ERROR');
      }
      const updatedCount = Array.isArray(updatedProjRows) ? updatedProjRows.length : 0;
      if (updatedCount !== projPkIds.length) {
        incrementRefactorMetric('oci_ack_projection_target_mismatch_total');
        const body = {
          ok: false,
          code: 'ACK_PROJECTION_TARGET_MISMATCH',
          reason_group: 'ACK_PROJECTION_TARGET_MISMATCH',
          target_type: 'projection',
          error: 'update_count_mismatch',
          expected_count: projPkIds.length,
          actual_count: updatedCount,
        };
        if (receipt.receiptId) {
          try {
            await completeAckReceipt({
              receiptId: receipt.receiptId,
              siteId: siteUuid,
              resultSnapshot: { ...body, ok: false, _ack_http_status: 409 } as Record<string, unknown>,
            });
            await appendRoutingHop({
              siteId: siteUuid,
              lane: 'ack',
              unitId: receipt.receiptId,
              fromState: 'REGISTERED',
              toState: 'APPLIED',
              reasonCode: 'ACK_PROJ_ADJ_TARGET_MISMATCH',
              idempotencyKey: `ack_proj_update_mismatch:${receipt.receiptId}`,
            });
          } catch (ledgerErr) {
            logError('OCI_ACK_RECEIPT_LEDGER_APPEND_FAILED', {
              receiptId: receipt.receiptId,
              error: ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr),
            });
          }
        }
        return NextResponse.json(body, { status: 409 });
      }
      actualTransitionedCount += updatedCount;
      logInfo('OCI_ACK_PROJ_COMPLETED', { site_id: siteUuid, count: updatedCount });
    }

    // ── adj_ prefix: conversion_adjustments rows (strict PROCESSING → COMPLETED) ──
    if (projAdjTargets && projAdjTargets.adjustmentIds.length > 0) {
      const adjPkIds = projAdjTargets.adjustmentIds;
      const { data: updatedAdjRows, error: adjError } = await adminClient
        .from('conversion_adjustments')
        .update({ status: 'COMPLETED', processed_at: now, updated_at: now })
        .in('id', adjPkIds)
        .eq('site_id', siteUuid)
        .eq('status', 'PROCESSING')
        .select('id');

      if (adjError) {
        return dbUpstreamResponse('OCI_ACK_ADJ_ERROR', adjError, 'OCI_ACK_ADJ_ERROR');
      }
      const updatedAdjCount = Array.isArray(updatedAdjRows) ? updatedAdjRows.length : 0;
      if (updatedAdjCount !== adjPkIds.length) {
        incrementRefactorMetric('oci_ack_adjustment_target_mismatch_total');
        const body = {
          ok: false,
          code: 'ACK_ADJUSTMENT_TARGET_MISMATCH',
          reason_group: 'ACK_ADJUSTMENT_TARGET_MISMATCH',
          target_type: 'adjustment',
          error: 'update_count_mismatch',
          expected_count: adjPkIds.length,
          actual_count: updatedAdjCount,
        };
        if (receipt.receiptId) {
          try {
            await completeAckReceipt({
              receiptId: receipt.receiptId,
              siteId: siteUuid,
              resultSnapshot: { ...body, ok: false, _ack_http_status: 409 } as Record<string, unknown>,
            });
            await appendRoutingHop({
              siteId: siteUuid,
              lane: 'ack',
              unitId: receipt.receiptId,
              fromState: 'REGISTERED',
              toState: 'APPLIED',
              reasonCode: 'ACK_PROJ_ADJ_TARGET_MISMATCH',
              idempotencyKey: `ack_adj_update_mismatch:${receipt.receiptId}`,
            });
          } catch (ledgerErr) {
            logError('OCI_ACK_RECEIPT_LEDGER_APPEND_FAILED', {
              receiptId: receipt.receiptId,
              error: ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr),
            });
          }
        }
        return NextResponse.json(body, { status: 409 });
      }
      actualTransitionedCount += updatedAdjCount;
      logInfo('OCI_ACK_ADJ_COMPLETED', { site_id: siteUuid, count: updatedAdjCount });
    }

    const failedRedisCleanups: string[] = [];
    const allPvIds = [...pvIds, ...pvSkippedIds];
    if (allPvIds.length > 0) {
      const processingKeys = getPvProcessingKeysForCleanup(siteUuid, resolvedSite?.public_id ?? null);
      // Run all del + lrem operations in parallel instead of serial await per ID.
      // For 500 IDs this reduces ~1000 sequential round-trips to a single parallel fan-out.
      const results = await Promise.allSettled(
        allPvIds.map(async (pvId) => {
          await Promise.all([
            redis.del(getPvDataKey(pvId)),
            ...processingKeys.map((processingKey) => redis.lrem(processingKey, 0, pvId)),
          ]);
          return pvId;
        })
      );
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled') {
          actualTransitionedCount += 1;
        } else {
          const err = (results[i] as PromiseRejectedResult).reason;
          logError('OCI_ACK_PV_REDIS_ERROR', { pvId: allPvIds[i], error: err instanceof Error ? err.message : String(err) });
          failedRedisCleanups.push(allPvIds[i]);
        }
      }
    }

    const payload: {
      ok: boolean;
      updated: number;
      message?: string;
      warnings?: Record<string, unknown> & { redis_cleanup_failed?: string[] };
      export_run_id?: string;
      ack_finalization_policy?: string;
      ack_finalization_tally?: Record<string, number>;
      ack_finalization_observability?: Record<string, number>;
    } = {
      ok: true,
      updated: actualTransitionedCount + alreadyTerminalCount,
      message: Object.keys(warnings).length > 0 ? 'ACK completed with warnings' : undefined,
      export_run_id: exportRunId,
    };
    if (sealAckFinalizationTally && Object.keys(sealAckFinalizationTally).length > 0) {
      payload.ack_finalization_policy = 'EXPORT_CLAIM_SNAPSHOT_TRUSTED_PR9I1';
      payload.ack_finalization_tally = { ...sealAckFinalizationTally } as Record<string, number>;
      payload.ack_finalization_observability = mapAckFinalizationTallyToObservability(sealAckFinalizationTally);
    }
    if (Object.keys(warnings).length > 0) {
      payload.warnings = { ...warnings };
    }
    if (failedRedisCleanups.length > 0) {
      payload.warnings = { ...(payload.warnings ?? {}), redis_cleanup_failed: failedRedisCleanups };
    }
    if (Object.keys(payload.warnings ?? {}).length === 0) {
      delete payload.warnings;
    }
    if (receipt.receiptId) {
      try {
        await completeAckReceipt({
          receiptId: receipt.receiptId,
          siteId: siteUuid,
          resultSnapshot: payload as Record<string, unknown>,
        });
        await appendRoutingHop({
          siteId: siteUuid,
          lane: 'ack',
          unitId: receipt.receiptId,
          fromState: 'REGISTERED',
          toState: 'APPLIED',
          reasonCode: 'ACK_COMPUTED',
          idempotencyKey: `ack:${receipt.receiptId}`,
        });
      } catch (ledgerErr) {
        logError('OCI_ACK_RECEIPT_LEDGER_APPEND_FAILED', {
          receiptId: receipt.receiptId,
          error: ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr),
        });
        payload.warnings = { ...(payload.warnings ?? {}), receipt_persist_warning: true };
      }
    }

    const totalExpectedCount = new Set([...queueIds, ...skippedIds, ...failedGranularIds]).size;
    const verification = verifyTransitionCount({
      expectedCount: totalExpectedCount,
      transitionedCount: actualTransitionedCount,
      alreadyTerminalCount,
      exportRunId,
      route: 'ack'
    });

    if (!verification.ok) {
      if (Object.keys(warnings).length > 0) {
        (verification.payload as Record<string, unknown>).warnings = warnings;
      }
      if (receipt.receiptId) {
        try {
          await completeAckReceipt({
            receiptId: receipt.receiptId,
            siteId: siteUuid,
            resultSnapshot: verification.payload as Record<string, unknown>,
          });
          await appendRoutingHop({
            siteId: siteUuid,
            lane: 'ack',
            unitId: receipt.receiptId,
            fromState: 'REGISTERED',
            toState: 'APPLIED',
            reasonCode: 'ACK_MISMATCH_COMPUTED',
            idempotencyKey: `ack_mismatch:${receipt.receiptId}`,
          });
        } catch (e) {
          logError('OCI_ACK_RECEIPT_LEDGER_MISMATCH_APPEND_FAILED', {
            receiptId: receipt.receiptId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      return NextResponse.json(verification.payload, { status: verification.isReplay ? 200 : 409 });
    }

    return NextResponse.json(payload);
  } catch (e: unknown) {
    logError('OCI_ACK_ERROR', { error: e instanceof Error ? e.message : String(e) });
    if (isInfrastructurePostgrestError(e)) {
      return dbUpstreamResponse('OCI_ACK_UNHANDLED_INFRA', e, 'OCI_ACK_UNHANDLED');
    }
    return NextResponse.json(
      { error: 'ACK request could not be processed', code: 'ACK_PROCESSING_ERROR', retryable: true },
      { status: 503 }
    );
  }
}
