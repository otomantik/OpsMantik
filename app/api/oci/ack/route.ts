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
import { logError, logWarn, logInfo } from '@/lib/logging/logger';
import * as jose from 'jose';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const bearer = (req.headers.get('authorization') || '').trim();
    const sessionToken = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : '';
    const apiKey = (req.headers.get('x-api-key') || '').trim();
    const envKey = (process.env.OCI_API_KEY || '').trim();

    let authedByGlobalKey = false;
    let siteIdFromToken = '';

    if (sessionToken) {
      const parsed = await verifySessionToken(sessionToken);
      if (parsed) {
        siteIdFromToken = parsed.siteId;
      }
    }

    if (envKey && apiKey && timingSafeCompare(apiKey, envKey)) {
      authedByGlobalKey = true;
    }

    // P0-4.1: Proceed if valid session OR API key attempt
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
    const byId = await adminClient.from('sites').select('id, oci_api_key').eq('id', siteId).maybeSingle();
    const siteRow = byId.data ?? null;
    let resolvedSite: { id: string; oci_api_key?: string | null } | null = siteRow as { id: string; oci_api_key?: string | null } | null;
    if (!resolvedSite) {
      const byPublic = await adminClient.from('sites').select('id, oci_api_key').eq('public_id', siteId).maybeSingle();
      resolvedSite = byPublic.data as { id: string; oci_api_key?: string | null } | null;
    }
    if (resolvedSite) siteUuid = resolvedSite.id;

    // P0-4.1: Final Authentication Verification
    if (apiKey && !authedByGlobalKey) {
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

    const siteRedisKey = siteId;

    const now = new Date().toISOString();
    let totalUpdated = 0;

    if (sealIds.length > 0) {
      const updatePayload = pendingConfirmation
        ? { status: 'UPLOADED' as const, updated_at: now }
        : { status: 'COMPLETED' as const, uploaded_at: now, updated_at: now };
      const { data, error } = await adminClient
        .from('offline_conversion_queue')
        .update(updatePayload)
        .in('id', sealIds)
        .eq('site_id', siteUuid)
        .in('status', ['PROCESSING'])
        .select('id');

      if (error) {
        logError('OCI_ACK_SQL_ERROR', { code: (error as { code?: string })?.code });
        return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
      }
      totalUpdated += Array.isArray(data) ? data.length : 0;
    }

    if (sealSkippedIds.length > 0) {
      const { data, error } = await adminClient
        .from('offline_conversion_queue')
        .update({
          status: 'COMPLETED',
          provider_error_code: 'V1_SAMPLED_OUT',
          provider_error_category: 'DETERMINISTIC_SKIP',
          updated_at: now,
        })
        .in('id', sealSkippedIds)
        .eq('site_id', siteUuid)
        .in('status', ['PROCESSING'])
        .select('id');

      if (error) {
        logError('OCI_ACK_SKIPPED_SQL_ERROR', { code: (error as { code?: string })?.code });
        return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
      }
      totalUpdated += Array.isArray(data) ? data.length : 0;
    }

    if (signalIds.length > 0) {
      const { data, error } = await adminClient
        .from('marketing_signals')
        .update({
          dispatch_status: 'SENT',
          google_sent_at: now,
        })
        .in('id', signalIds)
        .eq('site_id', siteUuid)
        .eq('dispatch_status', 'PENDING')
        .select('id');

      if (error) {
        logError('OCI_ACK_SIGNALS_SQL_ERROR', { code: (error as { code?: string })?.code });
        return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
      }
      totalUpdated += Array.isArray(data) ? data.length : 0;
    }

    const failedRedisCleanups: string[] = [];
    const allPvIds = [...pvIds, ...pvSkippedIds];
    if (allPvIds.length > 0) {
      const processingKey = `pv:processing:${siteRedisKey}`;
      for (const pvId of allPvIds) {
        try {
          await redis.del(`pv:data:${pvId}`);
          await redis.lrem(processingKey, 0, pvId);
          totalUpdated += 1;
        } catch (redisErr) {
          logError('OCI_ACK_PV_REDIS_ERROR', { pvId, error: redisErr instanceof Error ? redisErr.message : String(redisErr) });
          failedRedisCleanups.push(pvId);
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
