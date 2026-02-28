/**
 * POST /api/oci/ack — Script yükleme sonrası: Google'a giden kayıtları onaylar.
 *
 * Tri-Pipeline: Script queueIds'leri seal_, signal_, pv_ prefix'i ile gönderir.
 * - seal_* → offline_conversion_queue (status=COMPLETED, uploaded_at=NOW)
 * - signal_* → marketing_signals (dispatch_status=SENT, google_sent_at=NOW)
 * - pv_* → Redis: DEL pv:data:{id}, LREM pv:processing:{siteId}
 *
 * Body: { siteId: string, queueIds: string[] }
 * Auth: x-api-key = OCI_API_KEY (export ile aynı).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { redis } from '@/lib/upstash';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { verifySessionToken } from '@/lib/oci/session-auth';
import { logError } from '@/lib/logging/logger';

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
        namespace: 'oci-ack-authfail',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const siteIdBody = typeof body.siteId === 'string' ? body.siteId.trim() : '';
    const siteId = siteIdFromToken || siteIdBody;
    const rawIds = Array.isArray(body.queueIds) ? body.queueIds : [];
    const queueIds = rawIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);

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
    const signalIds: string[] = [];
    const pvIds: string[] = [];
    for (const id of queueIds) {
      const s = String(id);
      if (s.startsWith('seal_')) sealIds.push(s.slice(5));
      else if (s.startsWith('signal_')) signalIds.push(s.slice(7));
      else if (s.startsWith('pv_')) pvIds.push(s);
    }

    const siteRedisKey = siteId;

    const now = new Date().toISOString();
    let totalUpdated = 0;

    if (sealIds.length > 0) {
      const { data, error } = await adminClient
        .from('offline_conversion_queue')
        .update({
          status: 'COMPLETED',
          uploaded_at: now,
          updated_at: now,
        })
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

    if (pvIds.length > 0) {
      try {
        const processingKey = `pv:processing:${siteRedisKey}`;
        for (const pvId of pvIds) {
          await redis.del(`pv:data:${pvId}`);
          await redis.lrem(processingKey, 0, pvId);
        }
        totalUpdated += pvIds.length;
      } catch (redisErr) {
        logError('OCI_ACK_PV_REDIS_ERROR', { error: redisErr instanceof Error ? redisErr.message : String(redisErr) });
      }
    }

    return NextResponse.json({ ok: true, updated: totalUpdated });
  } catch (e: unknown) {
    logError('OCI_ACK_ERROR', { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
  }
}
