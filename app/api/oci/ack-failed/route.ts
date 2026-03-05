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
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { verifySessionToken } from '@/lib/oci/session-auth';
import { MAX_ATTEMPTS } from '@/lib/domain/oci/queue-types';
import { insertDeadLetterAuditLogs } from '@/lib/oci/dead-letter-audit';
import { insertQueueTransitions, queueSnapshotPayloadToTransition } from '@/lib/oci/queue-transition-ledger';
import { logError, logInfo } from '@/lib/logging/logger';
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
        namespace: 'oci-ack-failed-authfail',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    const body = await req.json().catch(() => ({}));
    const siteIdBody = typeof body.siteId === 'string' ? body.siteId.trim() : '';
    const siteId = siteIdFromToken || siteIdBody;
    const rawIds = Array.isArray(body.queueIds) ? body.queueIds : [];
    const queueIds = rawIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);

    // Phase 6.3: Poison Pill Fatal Errors
    const rawFatal = Array.isArray(body.fatalErrorIds) ? body.fatalErrorIds : [];
    const fatalIds = rawFatal.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);

    const errorCode = typeof body.errorCode === 'string' ? body.errorCode.trim().slice(0, 64) : 'VALIDATION_FAILED';
    const errorMessage = typeof body.errorMessage === 'string' ? body.errorMessage.trim().slice(0, 1024) : errorCode;
    const category: AckFailedCategory = ['VALIDATION', 'TRANSIENT', 'AUTH'].includes(body.errorCategory)
      ? body.errorCategory
      : 'VALIDATION';

    if (!siteId) {
      return NextResponse.json({ error: 'Missing siteId' }, { status: 400 });
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

    if (queueIds.length === 0 && fatalIds.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    const sealFailedIds: string[] = [];
    const signalFailedIds: string[] = [];
    for (const id of queueIds) {
      const s = String(id);
      if (s.startsWith('seal_')) sealFailedIds.push(s.slice(5));
      else if (s.startsWith('signal_')) signalFailedIds.push(s.slice(7));
    }

    const sealFatalIds: string[] = [];
    const signalFatalIds: string[] = [];
    for (const id of fatalIds) {
      const s = String(id);
      if (s.startsWith('seal_')) sealFatalIds.push(s.slice(5));
      else if (s.startsWith('signal_')) signalFatalIds.push(s.slice(7));
    }

    const now = new Date().toISOString();
    const nextRetryAt = new Date(Date.now() + 30 * 1000).toISOString();
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

      const retryableSealIds = sealRowsList
        .filter((row) => category === 'TRANSIENT' && (row.attempt_count ?? 0) < MAX_ATTEMPTS)
        .map((row) => row.id);
      const failedSealIds = sealRowsList
        .filter((row) => category !== 'TRANSIENT' && (row.attempt_count ?? 0) < MAX_ATTEMPTS)
        .map((row) => row.id);
      const deadLetterSealRows = sealRowsList.filter((row) => (row.attempt_count ?? 0) >= MAX_ATTEMPTS);

      if (retryableSealIds.length > 0) {
        updatedCount += await insertQueueTransitions(
          adminClient,
          retryableSealIds.map((id) =>
            queueSnapshotPayloadToTransition(
              id,
              {
                status: 'RETRY',
                next_retry_at: nextRetryAt,
                last_error: errorMessage,
                provider_error_code: errorCode,
                provider_error_category: 'TRANSIENT',
                updated_at: now,
              },
              'SCRIPT'
            )
          )
        );
      }

      if (failedSealIds.length > 0) {
        updatedCount += await insertQueueTransitions(
          adminClient,
          failedSealIds.map((id) =>
            queueSnapshotPayloadToTransition(
              id,
              {
                status: 'FAILED',
                last_error: errorMessage,
                provider_error_code: errorCode,
                provider_error_category: category,
                updated_at: now,
              },
              'SCRIPT'
            )
          )
        );
      }

      if (deadLetterSealRows.length > 0) {
        updatedCount += await insertQueueTransitions(
          adminClient,
          deadLetterSealRows.map((row) =>
            queueSnapshotPayloadToTransition(
              row.id,
              {
                status: 'DEAD_LETTER_QUARANTINE',
                last_error: errorMessage,
                provider_error_code: errorCode,
                provider_error_category: 'PERMANENT',
                updated_at: now,
              },
              'SCRIPT'
            )
          )
        );
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
      const updatePayload = category === 'TRANSIENT'
        ? { dispatch_status: 'PENDING' as const, updated_at: now }
        : { dispatch_status: 'FAILED' as const, updated_at: now };
      const { data } = await adminClient
        .from('marketing_signals')
        .update(updatePayload)
        .in('id', signalFailedIds)
        .eq('site_id', siteUuid)
        .eq('dispatch_status', 'PROCESSING')
        .select('id');
      updatedCount += Array.isArray(data) ? data.length : 0;
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
      updatedCount += await insertQueueTransitions(
        adminClient,
        fatalRowsList.map((row) =>
          queueSnapshotPayloadToTransition(
            row.id,
            {
              status: 'DEAD_LETTER_QUARANTINE',
              last_error: errorMessage,
              provider_error_code: errorCode,
              provider_error_category: 'PERMANENT',
              updated_at: now,
            },
            'SCRIPT'
          )
        )
      );
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
      const { data } = await adminClient
        .from('marketing_signals')
        .update({
          dispatch_status: 'DEAD_LETTER_QUARANTINE',
          updated_at: now,
        })
        .in('id', signalFatalIds)
        .eq('site_id', siteUuid)
        .eq('dispatch_status', 'PROCESSING')
        .select('id, trace_id');
      const updatedRows = Array.isArray(data)
        ? data as Array<{ id: string; trace_id: string | null }>
        : [];
      updatedCount += updatedRows.length;
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

    return NextResponse.json({ ok: true, updated: updatedCount });
  } catch (e: unknown) {
    logError('OCI_ACK_FAILED_ERROR', { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
  }
}
