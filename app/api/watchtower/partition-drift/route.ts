import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { logWarn, logError } from '@/lib/logging/logger';
import * as Sentry from '@sentry/nextjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/watchtower/partition-drift';

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.WATCHTOWER_SECRET || '';
  if (!expected) return false;
  const header = req.headers.get('authorization') || req.headers.get('x-watchtower-secret') || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : header.trim();
  if (!token) return false;
  return timingSafeCompare(token, expected);
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? undefined;
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [driftRes, ociRes] = await Promise.all([
      adminClient.rpc('watchtower_partition_drift_check_v1'),
      adminClient.rpc('watchtower_oci_health_check_v1'),
    ]);

    if (driftRes.error) {
      logError('watchtower partition drift rpc error', { request_id: requestId, route: ROUTE, message: driftRes.error.message });
      Sentry.captureException(driftRes.error, { tags: { route: ROUTE, request_id: requestId } });
    }
    if (ociRes.error) {
      logError('watchtower oci health rpc error', { request_id: requestId, route: ROUTE, message: ociRes.error.message });
      Sentry.captureException(ociRes.error, { tags: { route: ROUTE, request_id: requestId } });
    }

    const driftPayload = (driftRes.data || { ok: false }) as Record<string, unknown>;
    const ociPayload = (ociRes.data || { ok: false }) as Record<string, unknown>;

    const ok = Boolean(driftPayload.ok) && Boolean(ociPayload.ok);
    const result = {
      ok,
      drift: driftPayload,
      oci_health: ociPayload,
      checked_at: new Date().toISOString(),
    };

    if (!ok) {
      logWarn('watchtower health check failure', { request_id: requestId, route: ROUTE, result });
      Sentry.captureMessage('watchtower_health_check_failed', { 
        level: 'warning', 
        tags: { route: ROUTE, request_id: requestId },
        extra: { result }
      });
    }

    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logError('watchtower partition drift unhandled error', { request_id: requestId, route: ROUTE, message: msg });
    Sentry.captureException(e, { tags: { route: ROUTE, request_id: requestId } });
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

