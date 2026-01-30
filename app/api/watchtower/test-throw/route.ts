/**
 * GO W2 — Test-throw endpoint for smoke: only throws when WATCHTOWER_TEST_THROW=1.
 * Returns 200 with { ok: true } otherwise.
 * Used by scripts/smoke/watchtower-proof.mjs to verify 500 + x-request-id.
 */
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

export const dynamic = 'force-dynamic';

const TEST_THROW_MSG = 'Watchtower test throw (WATCHTOWER_TEST_THROW=1)';

export async function GET(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? undefined;

  if (process.env.WATCHTOWER_TEST_THROW === '1') {
    const err = new Error(TEST_THROW_MSG);
    Sentry.captureException(err, { tags: { request_id: requestId, route: '/api/watchtower/test-throw' } });
    throw err;
  }

  return NextResponse.json(
    { ok: true, request_id: requestId },
    {
      status: 200,
      headers: requestId ? { 'x-request-id': requestId } : undefined,
    }
  );
}
