/**
 * GET/POST /api/cron/pulse-recovery — Self-Healing Pulse (MODULE 2)
 *
 * Queue-only modelde legacy pulse katmanı emeklidir.
 * Route, geriye dönük cron uyumluluğu için no-op sonuç döndürür.
 *
 * Auth: requireCronAuth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { runPulseRecovery } from '@/lib/oci/pulse-recovery-worker';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return run();
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return run();
}

async function run() {
  try {
    const result = await runPulseRecovery();
    return NextResponse.json(
      {
        ok: true,
        ...result,
      },
      { headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}
