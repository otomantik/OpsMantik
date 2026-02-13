import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { logInfo } from '@/lib/logging/logger';
import { WatchtowerService } from '@/lib/services/watchtower';

export const runtime = 'nodejs'; // Force Node.js runtime for stability

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;

  try {
    const health = await WatchtowerService.runDiagnostics();

    if (health.status === 'alarm') {
      console.error('[WATCHTOWER] CRON DETECTED ALARM STATE');
    }

    const requestId = req.headers.get('x-request-id') ?? undefined;
    const ts = health.details.timestamp;
    const sessionsCount = health.checks.sessionsLastHour.count;
    const gclidCount = health.checks.gclidLast3Hours.count;
    logInfo('WATCHTOWER_OK', {
      request_id: requestId,
      ts,
      sessionsLastHour: sessionsCount,
      gclidLast3Hours: gclidCount,
      status: health.status,
    });

    return NextResponse.json({
      ok: true,
      code: 'WATCHTOWER_OK',
      status: health.status,
      checks: health.checks,
      details: health.details,
    });
  } catch (error) {
    console.error('[WATCHTOWER] Cron execution failed:', error);
    return NextResponse.json(
      {
        ok: false,
        status: 'error',
        message: 'Watchtower execution failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
