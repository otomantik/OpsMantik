/**
 * POST /api/oci/ack — Script yükleme sonrası: Google'a giden kayıtları onaylar.
 *
 * Tri-Pipeline: Script queueIds'leri seal_, signal_, pv_ prefix'i ile gönderir.
 * - seal_* → offline_conversion_queue (status=COMPLETED or UPLOADED; see pendingConfirmation)
 * - signal_* → marketing_signals (dispatch_status=SENT, google_sent_at=NOW)
 * - pv_* → Redis: DEL pv:data:{id}, LREM pv:processing:{siteId}
 *
 * Body:
 * - Legacy: { siteId: string, queueIds: string[], skippedIds?: string[], pendingConfirmation?: boolean }
 * - Granular: { siteId: string, results: [{ id: string, status: 'SUCCESS'|'FAILED', reason?: string }], pendingConfirmation?: boolean }
 * - pendingConfirmation=true: AdsApp bulk upload is asynchronous; mark seal_* as UPLOADED (not COMPLETED).
 *   Row-level errors cannot be fetched via Scripts — check Google Ads UI > Tools > Uploads.
 * - pendingConfirmation=false or omitted: Mark as COMPLETED (API path or explicit confirmation).
 * skippedIds: DETERMINISTIC_SKIP (V1 sampled out). seal_* → COMPLETED + provider_error_code=V1_SAMPLED_OUT.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { redis } from '@/lib/upstash';
import { getPvDataKey, getPvProcessingKeysForCleanup } from '@/lib/oci/pv-redis';
import { isCallSendableForSealExport } from '@/lib/oci/call-sendability';
import { fetchCallSendabilityRowsForSite } from '@/lib/oci/call-sendability-fetch';
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
  reconcileSignalDispatchOutcome,
} from '@/lib/oci/oci-ack-route-helpers';
import * as jose from 'jose';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const warnings: Record<string, unknown> = {};
  try {
    const lane = assertLaneActive('OCI_ACK');
    if (!lane.ok) {
      return NextResponse.json({ error: 'OCI ACK paused', code: lane.code }, { status: 503 });
    }
    // Phase 8.2: JWS Asymmetric Signature Verification (Optional enforcement)
    // If signature is present, we verify. If not, we fall back to API Key / Session auth.
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
        logError('OCI_ACK_CRYPTO_MISMATCH', { error: err instanceof Error ? err.message : String(err) });
        return NextResponse.json({ error: 'Cryptographic Mismatch', code: 'AUTH_FAILED' }, { status: 401 });
      }
    } else if (publicKeyB64 && !signature) {
      logInfo('OCI_ACK_SIMPLE_AUTH', { msg: 'No crypto signature; proceeding with API Key validation.' });
    }

    let bodyUnknown: unknown;
    try {
      bodyUnknown = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'BAD_REQUEST' }, { status: 400 });
    }
    const parsed = parseAckJsonEnvelope(bodyUnknown);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: 'Body must be a JSON object or granular results array', code: 'BAD_REQUEST' },
        { status: 400 }
      );
    }
    const body = promoteSingleGranularResult(parsed.body);
    const siteIdFromBody = typeof body.siteId === 'string' ? body.siteId : undefined;
    const auth = await resolveOciScriptAuth({
      req,
      siteIdFromBody,
      authFailNamespace: 'oci-ack-authfail',
    });
    if (!auth.ok) return auth.response;
    const siteUuid = auth.siteUuid;
    const resolvedSite = auth.resolvedSite;
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
    const pendingConfirmation = body.pendingConfirmation === true;

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
    const signalSkippedIds: string[] = [];
    const pvSkippedIds: string[] = [];
    const unknownSkippedIds: string[] = [];
    for (const id of skippedIds) {
      const s = String(id);
      if (s.startsWith('seal_')) sealSkippedIds.push(s.slice(5));
      else if (s.startsWith('signal_')) signalSkippedIds.push(s.slice(7));
      else if (s.startsWith('pv_')) pvSkippedIds.push(s.slice(3));
      else unknownSkippedIds.push(s);
    }
    if (unknownSkippedIds.length > 0) {
      return NextResponse.json(
        { error: 'Unknown ACK skipped id prefix', code: 'ACK_UNKNOWN_PREFIX', unknownIds: unknownSkippedIds },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
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
        results: granularResults,
      },
    });
    if (receipt.replayed) {
      if (receipt.resultSnapshot) {
        return NextResponse.json(receipt.resultSnapshot);
      }
      if (receipt.inProgress) {
        return NextResponse.json(
          { ok: false, code: 'ACK_REPLAY_IN_PROGRESS', retryable: true },
          { status: 202 }
        );
      }
    }
    let totalUpdated = 0;

    // Idempotent ack logic: rows already in a terminal state (COMPLETED, UPLOADED) count
    // as already-acked and are returned as successes. Only rows in genuinely unexpected
    // states (QUEUED, RETRY, VOIDED_BY_REVERSAL, FAILED, or not found) produce warnings.
    // This makes the ack operation safe to retry after a network cut mid-response.
    const TERMINAL_STATES = ['COMPLETED', 'UPLOADED', 'COMPLETED_UNVERIFIED'];

    if (sealIds.length > 0) {
      const { data, error } = await adminClient
        .from('offline_conversion_queue')
        .select('id, status, call_id')
        .in('id', sealIds)
        .eq('site_id', siteUuid);

      if (error) {
        return dbUpstreamResponse('OCI_ACK_SQL_ERROR', error, 'OCI_ACK_SQL_ERROR');
      }
      const allRows = Array.isArray(data) ? data as Array<{ id: string; status: string; call_id: string | null }> : [];
      const sealFound = new Set(allRows.map((r) => r.id));
      const missingSealIds = sealIds.filter((id) => !sealFound.has(id));
      if (missingSealIds.length > 0) {
        logError('OCI_ACK_SEAL_PARTIAL_MISSING', { requested: sealIds.length, found: allRows.length, missingSealIds });
        warnings.missing_seal_ids = missingSealIds;
      }
      const alreadyDone = allRows.filter(r => TERMINAL_STATES.includes(r.status));
      const processingRows = allRows.filter(r => r.status === 'PROCESSING');
      const unexpected = allRows.filter(r => !TERMINAL_STATES.includes(r.status) && r.status !== 'PROCESSING');
      const processingCallIds = [...new Set(processingRows.map((row) => row.call_id).filter((value): value is string => Boolean(value)))];
      const callStatusById = new Map<string, { status: string | null; oci_status: string | null }>();
      if (processingCallIds.length > 0) {
        const sendabilityMap = await fetchCallSendabilityRowsForSite(siteUuid, processingCallIds);
        for (const callId of processingCallIds) {
          callStatusById.set(callId, sendabilityMap.get(callId) ?? { status: null, oci_status: null });
        }
      }
      const blockedRows = processingRows.filter((row) => {
        if (!row.call_id) return false;
        const callState = callStatusById.get(row.call_id);
        return !isCallSendableForSealExport(callState?.status, callState?.oci_status);
      });
      const blockedIds = new Set(blockedRows.map((row) => row.id));
      const toTransition = processingRows.filter((row) => !blockedIds.has(row.id));

      if (unexpected.length > 0) {
        logError('OCI_ACK_UNEXPECTED_STATE', { ids: unexpected.map(r => r.id), states: unexpected.map(r => r.status) });
      }
      if (alreadyDone.length > 0) {
        logInfo('OCI_ACK_IDEMPOTENT_SKIP', { already_done: alreadyDone.length, requested: sealIds.length });
      }
      totalUpdated += alreadyDone.length;

      if (toTransition.length > 0) {
        const clearFields = ['last_error', 'provider_error_code', 'provider_error_category', 'next_retry_at', 'claimed_at', 'provider_request_id', 'provider_ref'];
        const { data: updatedCount, error: rpcError } = await adminClient.rpc('append_script_transition_batch', {
          p_queue_ids: toTransition.map((row) => row.id),
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
        totalUpdated += updatedCount;
      }
      if (blockedRows.length > 0) {
        const { data: updatedCount, error: rpcError } = await adminClient.rpc('append_script_transition_batch', {
          p_queue_ids: blockedRows.map((row) => row.id),
          p_new_status: 'FAILED',
          p_created_at: now,
          p_error_payload: {
            last_error: 'CALL_NOT_SENDABLE_AFTER_EXPORT',
            provider_error_code: 'CALL_NOT_SENDABLE_AFTER_EXPORT',
            provider_error_category: 'DETERMINISTIC_SKIP',
            clear_fields: ['next_retry_at', 'uploaded_at', 'claimed_at', 'provider_request_id', 'provider_ref'],
          },
        });
        if (rpcError || typeof updatedCount !== 'number' || updatedCount !== blockedRows.length) {
          return dbUpstreamResponse(
            'OCI_ACK_BLOCKED_BATCH_RPC_FAILED',
            rpcError ?? new Error(`blocked batch expected ${blockedRows.length}, got ${updatedCount}`),
            'OCI_ACK_BLOCKED_BATCH_RPC_FAILED'
          );
        }
        totalUpdated += updatedCount;
        logInfo('OCI_ACK_BLOCKED_CALLS_TERMINALIZED', { site_id: siteUuid, count: blockedRows.length });
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
          totalUpdated += updatedCount;
          for (const r of processingRows) {
            const key = `seal_${r.id}`;
            const reason = failedReasonById.get(key);
            if (reason) {
              logInfo('OCI_ACK_GRANULAR_ROW_FAILED', { site_id: siteUuid, queue_id: r.id, reason });
            }
          }
        }
      }

      if (signalFailedIds.length > 0) {
        const granFail = await reconcileSignalDispatchOutcome(adminClient, {
          siteId: siteUuid,
          signalIds: signalFailedIds,
          expectStatus: 'PROCESSING',
          newStatus: 'FAILED',
        });
        for (const id of signalFailedIds) {
          const st = granFail.rowsSnapshot.get(id);
          if (st !== undefined && st !== 'PROCESSING') {
            totalUpdated += 1;
          }
        }
        if (granFail.missingIds.length > 0) {
          warnings.granular_failed_missing_signal_ids = granFail.missingIds;
        }
        if (granFail.stuckProcessingIds.length > 0) {
          logError('OCI_ACK_GRANULAR_SIGNAL_STILL_PROCESSING', {
            ids: granFail.stuckProcessingIds,
            rpcApplied: granFail.rpcApplied,
          });
          warnings.signals_still_processing = granFail.stuckProcessingIds;
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

      totalUpdated += alreadyDone.length;

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
        totalUpdated += updatedCount;
      }
    }

    if (signalIds.length > 0) {
      const { data: allSignals, error: fetchErr } = await adminClient
        .from('marketing_signals')
        .select('id, dispatch_status')
        .in('id', signalIds)
        .eq('site_id', siteUuid);

      if (fetchErr) {
        return dbUpstreamResponse('OCI_ACK_SIGNALS_SQL_ERROR', fetchErr, 'OCI_ACK_SIGNALS_SQL_ERROR');
      }
      const signalRows = Array.isArray(allSignals) ? allSignals as Array<{ id: string; dispatch_status: string }> : [];
      const byIdSig = new Map(signalRows.map((r) => [r.id, r.dispatch_status]));

      const missingSig = signalIds.filter((id) => !byIdSig.has(id));
      if (missingSig.length > 0) {
        logError('OCI_ACK_SIGNAL_PARTIAL_MISSING', { requested: signalIds.length, found: signalRows.length, missingSig });
        warnings.missing_signal_ids = missingSig;
      }

      const toUpdateSignals = signalRows.filter((r) => r.dispatch_status === 'PROCESSING');

      for (const id of signalIds) {
        const st = byIdSig.get(id);
        if (st !== undefined && st === 'SENT') {
          totalUpdated += 1;
        }
      }

      if (toUpdateSignals.length > 0) {
        const targetIds = toUpdateSignals.map((r) => r.id);
        const recon = await reconcileSignalDispatchOutcome(adminClient, {
          siteId: siteUuid,
          signalIds: targetIds,
          expectStatus: 'PROCESSING',
          newStatus: 'SENT',
          googleSentAt: now,
        });
        for (const id of targetIds) {
          const st = recon.rowsSnapshot.get(id);
          if (st !== undefined && st !== 'PROCESSING') {
            totalUpdated += 1;
          }
        }
        if (recon.stuckProcessingIds.length > 0) {
          logError('OCI_ACK_SIGNALS_STILL_PROCESSING_AFTER_ACK', {
            ids: recon.stuckProcessingIds,
            rpcApplied: recon.rpcApplied,
          });
          warnings.signals_still_processing = Array.isArray(warnings.signals_still_processing)
            ? [...(warnings.signals_still_processing as string[]), ...recon.stuckProcessingIds]
            : recon.stuckProcessingIds;
        }
      }
    }

    // ── proj_ prefix: call_funnel_projection rows ────────────────────────────
    if (projIds.length > 0) {
      const { data: projRows, error: projFetchError } = await adminClient
        .from('call_funnel_projection')
        .select('call_id')
        .in('call_id', projIds)
        .eq('site_id', siteUuid)
        .eq('export_status', 'READY');
      if (projFetchError) {
        return dbUpstreamResponse('OCI_ACK_PROJ_FETCH_ERROR', projFetchError, 'OCI_ACK_PROJ_FETCH_ERROR');
      }
      const targetProjIds = Array.isArray(projRows)
        ? (projRows as Array<{ call_id: string | null }>).map((r) => r.call_id).filter((v): v is string => Boolean(v))
        : [];
      if (targetProjIds.length > 0) {
        const { data: updatedProjRows, error: projError } = await adminClient
          .from('call_funnel_projection')
          .update({ export_status: pendingConfirmation ? 'UPLOADED' : 'EXPORTED', updated_at: new Date().toISOString() })
          .in('call_id', targetProjIds)
          .eq('site_id', siteUuid)
          .eq('export_status', 'READY')
          .select('call_id');

        if (projError) {
          logError('OCI_ACK_PROJ_ERROR', { code: (projError as { code?: string })?.code });
        } else {
          const updatedCount = Array.isArray(updatedProjRows) ? updatedProjRows.length : 0;
          totalUpdated += updatedCount;
          logInfo('OCI_ACK_PROJ_COMPLETED', { site_id: siteUuid, count: updatedCount });
        }
      }
    }

    // ── adj_ prefix: conversion_adjustments rows ─────────────────────────────
    if (adjIds.length > 0) {
      const { data: adjRows, error: adjFetchError } = await adminClient
        .from('conversion_adjustments')
        .select('id')
        .in('id', adjIds)
        .eq('site_id', siteUuid)
        .eq('status', 'PROCESSING');
      if (adjFetchError) {
        return dbUpstreamResponse('OCI_ACK_ADJ_FETCH_ERROR', adjFetchError, 'OCI_ACK_ADJ_FETCH_ERROR');
      }
      const targetAdjIds = Array.isArray(adjRows)
        ? (adjRows as Array<{ id: string | null }>).map((r) => r.id).filter((v): v is string => Boolean(v))
        : [];
      if (targetAdjIds.length > 0) {
        const { data: updatedAdjRows, error: adjError } = await adminClient
          .from('conversion_adjustments')
          .update({ status: 'COMPLETED', processed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .in('id', targetAdjIds)
          .eq('site_id', siteUuid)
          .eq('status', 'PROCESSING')
          .select('id');

        if (adjError) {
          logError('OCI_ACK_ADJ_ERROR', { code: (adjError as { code?: string })?.code });
        } else {
          const updatedCount = Array.isArray(updatedAdjRows) ? updatedAdjRows.length : 0;
          totalUpdated += updatedCount;
          logInfo('OCI_ACK_ADJ_COMPLETED', { site_id: siteUuid, count: updatedCount });
        }
      }
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
          totalUpdated += 1;
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
    } = {
      ok: true,
      updated: totalUpdated,
      message: Object.keys(warnings).length > 0 ? 'ACK completed with warnings' : undefined,
    };
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
