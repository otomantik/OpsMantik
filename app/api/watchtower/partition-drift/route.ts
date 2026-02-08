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
    const { data, error } = await adminClient.rpc('watchtower_partition_drift_check_v1');
    if (error) {
      logError('watchtower partition drift rpc error', { request_id: requestId, route: ROUTE, message: error.message, code: error.code });
      Sentry.captureException(error, { tags: { route: ROUTE, request_id: requestId } });
      return NextResponse.json({ ok: false, error: 'Failed to run check' }, { status: 500 });
    }

    const payload = typeof data === 'string' ? (() => { try { return JSON.parse(data); } catch { return { ok: false }; } })() : data;
    const ok = Boolean((payload as any)?.ok);
    if (!ok) {
      logWarn('watchtower partition drift check failed', { request_id: requestId, route: ROUTE, details: payload });
      Sentry.captureMessage('watchtower_partition_drift_failed', { level: 'warning', tags: { route: ROUTE, request_id: requestId } });
    }

    return NextResponse.json(payload);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logError('watchtower partition drift unhandled error', { request_id: requestId, route: ROUTE, message: msg });
    Sentry.captureException(e, { tags: { route: ROUTE, request_id: requestId } });
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

