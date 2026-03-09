/**
 * POST /api/oci/ack — Script yükleme sonrası: Google'a giden kayıtları onaylar.
 *
 * Tri-Pipeline: Script queueIds'leri seal_, signal_, pv_ prefix'i ile gönderir.
 * - seal_* → offline_conversion_queue (status=COMPLETED or UPLOADED; see pendingConfirmation)
 * - signal_* → marketing_signals (dispatch_status=SENT, google_sent_at=NOW)
 * - pv_* → Redis: DEL pv:data:{id}, LREM pv:processing:{siteId}
 *
 * Body: { siteId: string, queueIds: string[], skippedIds?: string[], pendingConfirmation?: boolean }
 * - pendingConfirmation=true: AdsApp bulk upload is asynchronous; mark seal_* as UPLOADED (not COMPLETED).
 *   Row-level errors cannot be fetched via Scripts — check Google Ads UI > Tools > Uploads.
 * - pendingConfirmation=false or omitted: Mark as COMPLETED (API path or explicit confirmation).
 * skippedIds: DETERMINISTIC_SKIP (V1 sampled out). seal_* → COMPLETED + provider_error_code=V1_SAMPLED_OUT.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { redis } from '@/lib/upstash';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { verifySessionToken } from '@/lib/oci/session-auth';
import { getPvDataKey, getPvProcessingKeysForCleanup } from '@/lib/oci/pv-redis';
import { isCallSendableForSealExport } from '@/lib/oci/call-sendability';
import { logError, logInfo } from '@/lib/logging/logger';
import * as jose from 'jose';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const bearer = (req.headers.get('authorization') || '').trim();
    const sessionToken = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : '';
    const apiKey = (req.headers.get('x-api-key') || '').trim();

    let siteIdFromToken = '';

    if (sessionToken) {
      const parsed = await verifySessionToken(sessionToken);
      if (parsed) {
        siteIdFromToken = parsed.siteId;
      }
    }

    // Proceed only if we have a valid session token or a per-site API key attempt.
    // Global OCI_API_KEY bypass was removed (tenant isolation violation).
    const hasAuthAttempt = !!siteIdFromToken || !!apiKey;

    if (!hasAuthAttempt) {
      const clientId = RateLimitService.getClientId(req);
      await RateLimitService.checkWithMode(clientId, 30, 60 * 1000, {
        mode: 'fail-closed',
        namespace: 'oci-ack-authfail',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    const body = await req.json().catch(() => ({}));
    const siteIdBody = typeof body.siteId === 'string' ? body.siteId.trim() : '';
    const siteId = siteIdFromToken || siteIdBody;
    const rawIds = Array.isArray(body.queueIds) ? body.queueIds : [];
    const queueIds = rawIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
    const rawSkipped = Array.isArray(body.skippedIds) ? body.skippedIds : [];
    const skippedIds = rawSkipped.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
    const pendingConfirmation = body.pendingConfirmation === true;

    if (!siteId) {
      return NextResponse.json({ error: 'Missing siteId' }, { status: 400 });
    }

    if (queueIds.length === 0 && skippedIds.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    let siteUuid = siteId;
    const byId = await adminClient.from('sites').select('id, public_id, oci_api_key').eq('id', siteId).maybeSingle();
    const siteRow = byId.data ?? null;
    let resolvedSite: { id: string; public_id?: string | null; oci_api_key?: string | null } | null = siteRow as { id: string; public_id?: string | null; oci_api_key?: string | null } | null;
    if (!resolvedSite) {
      const byPublic = await adminClient.from('sites').select('id, public_id, oci_api_key').eq('public_id', siteId).maybeSingle();
      resolvedSite = byPublic.data as { id: string; public_id?: string | null; oci_api_key?: string | null } | null;
    }
    if (resolvedSite) siteUuid = resolvedSite.id;

    // Final Authentication Verification — per-site only, no global bypass.
    if (apiKey) {
      if (!resolvedSite) {
        return NextResponse.json({ error: 'Unauthorized: Site not found' }, { status: 401 });
      }
      const siteKey = resolvedSite.oci_api_key ?? '';
      if (!siteKey || !timingSafeCompare(siteKey, apiKey)) {
        return NextResponse.json({ error: 'Unauthorized: Invalid API key' }, { status: 401 });
      }
    } else if (siteIdFromToken) {
      if (siteIdFromToken !== resolvedSite?.id) {
        return NextResponse.json({ error: 'Forbidden: Token site mismatch' }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sealIds: string[] = [];
    const signalIds: string[] = [];
    const pvIds: string[] = [];
    const sealSkippedIds: string[] = [];
    const signalSkippedIds: string[] = [];
    const pvSkippedIds: string[] = [];
    for (const id of queueIds) {
      const s = String(id);
      if (s.startsWith('seal_')) sealIds.push(s.slice(5));
      else if (s.startsWith('signal_')) signalIds.push(s.slice(7));
      else if (s.startsWith('pv_')) pvIds.push(s.slice(3));
      else pvIds.push(s);
    }
    for (const id of skippedIds) {
      const s = String(id);
      if (s.startsWith('seal_')) sealSkippedIds.push(s.slice(5));
      else if (s.startsWith('signal_')) signalSkippedIds.push(s.slice(7));
      else if (s.startsWith('pv_')) pvSkippedIds.push(s.slice(3));
      else pvSkippedIds.push(s);
    }

    const now = new Date().toISOString();
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
        logError('OCI_ACK_SQL_ERROR', { code: (error as { code?: string })?.code });
        return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
      }
      const allRows = Array.isArray(data) ? data as Array<{ id: string; status: string; call_id: string | null }> : [];
      const alreadyDone = allRows.filter(r => TERMINAL_STATES.includes(r.status));
      const processingRows = allRows.filter(r => r.status === 'PROCESSING');
      const unexpected = allRows.filter(r => !TERMINAL_STATES.includes(r.status) && r.status !== 'PROCESSING');
      const processingCallIds = [...new Set(processingRows.map((row) => row.call_id).filter((value): value is string => Boolean(value)))];
      const callStatusById = new Map<string, { status: string | null; oci_status: string | null }>();
      if (processingCallIds.length > 0) {
        const { data: calls, error: callError } = await adminClient
          .from('calls')
          .select('id, status, oci_status')
          .in('id', processingCallIds)
          .eq('site_id', siteUuid);
        if (callError) {
          logError('OCI_ACK_CALL_STATE_SQL_ERROR', { code: (callError as { code?: string })?.code });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
        for (const call of calls ?? []) {
          callStatusById.set((call as { id: string }).id, {
            status: (call as { status?: string | null }).status ?? null,
            oci_status: (call as { oci_status?: string | null }).oci_status ?? null,
          });
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
          logError('OCI_ACK_BATCH_RPC_FAILED', { code: (rpcError as { code?: string })?.code, requested: toTransition.length, updated: updatedCount });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
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
          logError('OCI_ACK_BLOCKED_BATCH_RPC_FAILED', {
            code: (rpcError as { code?: string })?.code,
            requested: blockedRows.length,
            updated: updatedCount,
          });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
        totalUpdated += updatedCount;
        logInfo('OCI_ACK_BLOCKED_CALLS_TERMINALIZED', { site_id: siteUuid, count: blockedRows.length });
      }
    }

    if (sealSkippedIds.length > 0) {
      const { data, error } = await adminClient
        .from('offline_conversion_queue')
        .select('id, status')
        .in('id', sealSkippedIds)
        .eq('site_id', siteUuid);

      if (error) {
        logError('OCI_ACK_SKIPPED_SQL_ERROR', { code: (error as { code?: string })?.code });
        return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
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
          logError('OCI_ACK_SKIPPED_BATCH_RPC_FAILED', { code: (rpcError as { code?: string })?.code, requested: toTransition.length, updated: updatedCount });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
        totalUpdated += updatedCount;
      }
    }

    if (signalIds.length > 0) {
      // Export already set these rows to PROCESSING; ack must match PROCESSING (idempotent: SENT also counts).
      const { data: allSignals, error: fetchErr } = await adminClient
        .from('marketing_signals')
        .select('id, dispatch_status')
        .in('id', signalIds)
        .eq('site_id', siteUuid);

      if (fetchErr) {
        logError('OCI_ACK_SIGNALS_SQL_ERROR', { code: (fetchErr as { code?: string })?.code });
        return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
      }
      const signalRows = Array.isArray(allSignals) ? allSignals as Array<{ id: string; dispatch_status: string }> : [];
      const alreadySentSignals = signalRows.filter(r => r.dispatch_status === 'SENT');
      const toUpdateSignals = signalRows.filter(r => r.dispatch_status === 'PROCESSING');

      totalUpdated += alreadySentSignals.length;

      if (toUpdateSignals.length > 0) {
        const { data: updated, error } = await adminClient
          .from('marketing_signals')
          .update({ dispatch_status: 'SENT', google_sent_at: now })
          .in('id', toUpdateSignals.map(r => r.id))
          .eq('site_id', siteUuid)
          .eq('dispatch_status', 'PROCESSING')
          .select('id');

        if (error) {
          logError('OCI_ACK_SIGNALS_UPDATE_ERROR', { code: (error as { code?: string })?.code });
          return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
        }
        totalUpdated += Array.isArray(updated) ? updated.length : 0;
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

    const payload: { ok: boolean; updated: number; warnings?: { redis_cleanup_failed: string[] } } = {
      ok: true,
      updated: totalUpdated,
    };
    if (failedRedisCleanups.length > 0) {
      payload.warnings = { redis_cleanup_failed: failedRedisCleanups };
    }
    return NextResponse.json(payload);
  } catch (e: unknown) {
    logError('OCI_ACK_ERROR', { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
  }
}
