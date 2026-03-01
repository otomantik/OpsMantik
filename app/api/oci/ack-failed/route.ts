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
import { logError, logInfo } from '@/lib/logging/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const bearer = (req.headers.get('authorization') || '').trim();
    const sessionToken = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : '';
    const apiKey = (req.headers.get('x-api-key') || '').trim();
    const envKey = (process.env.OCI_API_KEY || '').trim();

    let authed = false;
    let siteIdFromToken = '';

    if (sessionToken) {
      const parsed = verifySessionToken(sessionToken);
      if (parsed) {
        authed = true;
        siteIdFromToken = parsed.siteId;
      }
    }
    if (!authed && envKey && timingSafeCompare(apiKey, envKey)) {
      authed = true;
    }

    if (!authed) {
      const clientId = RateLimitService.getClientId(req);
      await RateLimitService.checkWithMode(clientId, 30, 60 * 1000, {
        mode: 'fail-closed',
        namespace: 'oci-ack-failed-authfail',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const siteIdBody = typeof body.siteId === 'string' ? body.siteId.trim() : '';
    const siteId = siteIdFromToken || siteIdBody;
    const rawIds = Array.isArray(body.queueIds) ? body.queueIds : [];
    const queueIds = rawIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
    const errorCode = typeof body.errorCode === 'string' ? body.errorCode.trim().slice(0, 64) : 'VALIDATION_FAILED';
    const errorMessage = typeof body.errorMessage === 'string' ? body.errorMessage.trim().slice(0, 1024) : errorCode;
    const category = ['VALIDATION', 'TRANSIENT', 'AUTH'].includes(body.errorCategory)
      ? body.errorCategory
      : 'VALIDATION';

    if (!siteId) {
      return NextResponse.json({ error: 'Missing siteId' }, { status: 400 });
    }

    let siteUuid = siteId;
    const byId = await adminClient.from('sites').select('id').eq('id', siteId).maybeSingle();
    if (byId.data) {
      siteUuid = (byId.data as { id: string }).id;
    } else {
      const byPublic = await adminClient.from('sites').select('id').eq('public_id', siteId).maybeSingle();
      if (byPublic.data) siteUuid = (byPublic.data as { id: string }).id;
    }

    if (queueIds.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    const sealIds: string[] = [];
    for (const id of queueIds) {
      const s = String(id);
      if (s.startsWith('seal_')) sealIds.push(s.slice(5));
      // signal_*, pv_* için şimdilik sadece seal destekleniyor (offline_conversion_queue)
    }

    if (sealIds.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    const now = new Date().toISOString();

    const { data, error } = await adminClient
      .from('offline_conversion_queue')
      .update({
        status: 'FAILED',
        last_error: errorMessage,
        provider_error_code: errorCode,
        provider_error_category: category,
        updated_at: now,
      })
      .in('id', sealIds)
      .eq('site_id', siteUuid)
      .in('status', ['PROCESSING'])
      .select('id');

    if (error) {
      logError('OCI_ACK_FAILED_SQL_ERROR', { code: (error as { code?: string })?.code });
      return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
    }

    const updated = Array.isArray(data) ? data.length : 0;
    if (updated > 0) {
      logInfo('OCI_ACK_FAILED_MARKED', {
        site_id: siteUuid,
        count: updated,
        error_code: errorCode,
        error_category: category,
      });
    }

    return NextResponse.json({ ok: true, updated });
  } catch (e: unknown) {
    logError('OCI_ACK_FAILED_ERROR', { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
  }
}
