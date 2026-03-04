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
import { logError, logInfo, logWarn } from '@/lib/logging/logger';
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
      const parsed = verifySessionToken(sessionToken);
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

    // Phase 8.2: JWS Asymmetric Signature Verification
    const signature = req.headers.get('x-oci-signature');
    const publicKeyB64 = process.env.VOID_PUBLIC_KEY;
    if (publicKeyB64) {
      if (!signature) {
        logWarn('OCI_ACK_FAILED_MISSING_CRYPTO_SIGNATURE', { siteId: (req.headers.get('x-site-id')) });
        return NextResponse.json({ error: 'Missing Cryptographic Signature', code: 'CRYPTO_REQUIRED' }, { status: 401 });
      }
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
    } else {
      logWarn('OCI_ACK_FAILED_CRYPTO_DISABLED', { msg: 'VOID_PUBLIC_KEY missing; asymmetric verification bypassed (DEV ONLY).' });
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
    const category = ['VALIDATION', 'TRANSIENT', 'AUTH'].includes(body.errorCategory)
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
    let updatedCount = 0;

    // Handle Transient/Validation Failures (Retryable or FAILED)
    if (sealFailedIds.length > 0) {
      const { data } = await adminClient
        .from('offline_conversion_queue')
        .update({
          status: 'FAILED',
          last_error: errorMessage,
          provider_error_code: errorCode,
          provider_error_category: category,
          updated_at: now,
        })
        .in('id', sealFailedIds)
        .eq('site_id', siteUuid)
        .in('status', ['PROCESSING'])
        .select('id');
      updatedCount += Array.isArray(data) ? data.length : 0;
    }

    if (signalFailedIds.length > 0) {
      const { data } = await adminClient
        .from('marketing_signals')
        .update({
          dispatch_status: 'FAILED',
          updated_at: now,
        })
        .in('id', signalFailedIds)
        .eq('site_id', siteUuid)
        .eq('dispatch_status', 'PENDING') // Strictly only if pending or processing if we had that
        .select('id');
      updatedCount += Array.isArray(data) ? data.length : 0;
    }

    // Phase 6.3: Handle Fatal Poison Pills (Quarantine)
    if (sealFatalIds.length > 0) {
      const { data } = await adminClient
        .from('offline_conversion_queue')
        .update({
          status: 'DEAD_LETTER_QUARANTINE',
          last_error: `POISON_PILL: ${errorMessage}`,
          provider_error_code: 'FATAL_POISON_PILL',
          provider_error_category: 'PERMANENT',
          updated_at: now,
        })
        .in('id', sealFatalIds)
        .eq('site_id', siteUuid)
        .select('id');
      updatedCount += Array.isArray(data) ? data.length : 0;
    }

    if (signalFatalIds.length > 0) {
      const { data } = await adminClient
        .from('marketing_signals')
        .update({
          dispatch_status: 'DEAD_LETTER_QUARANTINE', // We might need to ensure this status exists/works
          updated_at: now,
        })
        .in('id', signalFatalIds)
        .eq('site_id', siteUuid)
        .select('id');
      updatedCount += Array.isArray(data) ? data.length : 0;
    }

    if (updatedCount > 0) {
      logInfo('OCI_ACK_FAILED_MARKED', {
        site_id: siteUuid,
        count: updatedCount,
        error_code: errorCode,
        error_category: category,
        fatal_count: fatalIds.length,
      });
    }

    return NextResponse.json({ ok: true, updated: updatedCount });
  } catch (e: unknown) {
    logError('OCI_ACK_FAILED_ERROR', { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
  }
}
