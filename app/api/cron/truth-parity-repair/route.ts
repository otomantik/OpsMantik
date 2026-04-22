import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { tryAcquireCronLock, releaseCronLock } from '@/lib/cron/with-cron-lock';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { runTruthParityRepairBatch } from '@/lib/domain/truth/parity-repair-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOCK_KEY = 'truth-parity-repair';

async function run() {
  const acquired = await tryAcquireCronLock(LOCK_KEY, 300);
  if (!acquired) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'lock_held' },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  }
  try {
    const result = await runTruthParityRepairBatch(100);
    return NextResponse.json({ ok: true, ...result }, { headers: getBuildInfoHeaders() });
  } finally {
    await releaseCronLock(LOCK_KEY);
  }
}

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
