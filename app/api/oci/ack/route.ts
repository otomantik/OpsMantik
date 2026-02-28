/**
 * POST /api/oci/ack — Script yükleme sonrası: Google'a giden queue satırlarını COMPLETED yapar.
 *
 * Google Ads Script başarılı upload'dan sonra bu endpoint'i çağırır (queue id listesi ile).
 * Böylece PROCESSING'de kalan kayıtlar tekrar RETRY'a düşüp çift gönderilmez.
 *
 * Body: { siteId: string, queueIds: string[] }
 * Auth: x-api-key = OCI_API_KEY (export ile aynı).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { logError } from '@/lib/logging/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const apiKey = (req.headers.get('x-api-key') || '').trim();
    const envKey = (process.env.OCI_API_KEY || '').trim();
    const authed = Boolean(envKey) && timingSafeCompare(apiKey, envKey);

    if (!authed) {
      const clientId = RateLimitService.getClientId(req);
      await RateLimitService.checkWithMode(clientId, 30, 60 * 1000, {
        mode: 'fail-closed',
        namespace: 'oci-ack-authfail',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const siteId = typeof body.siteId === 'string' ? body.siteId.trim() : '';
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

    const now = new Date().toISOString();
    const { data, error } = await adminClient
      .from('offline_conversion_queue')
      .update({
        status: 'COMPLETED',
        uploaded_at: now,
        updated_at: now,
      })
      .in('id', queueIds)
      .eq('site_id', siteUuid)
      .in('status', ['PROCESSING'])
      .select('id');

    if (error) {
      logError('OCI_ACK_SQL_ERROR', { code: (error as { code?: string })?.code });
      return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
    }

    const updated = Array.isArray(data) ? data.length : 0;
    return NextResponse.json({ ok: true, updated });
  } catch (e: unknown) {
    logError('OCI_ACK_ERROR', { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
  }
}
