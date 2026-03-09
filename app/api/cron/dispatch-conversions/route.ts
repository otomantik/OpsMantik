import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function retiredResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: 'Legacy conversions cron has been retired',
      code: 'LEGACY_CONVERSIONS_CRON_RETIRED',
      canonical_routes: [
        '/api/cron/process-offline-conversions',
        '/api/cron/oci/process-outbox-events',
      ],
    },
    { status: 410, headers: getBuildInfoHeaders() }
  );
}

export async function GET(_req: NextRequest) {
  return retiredResponse();
}

export async function POST(_req: NextRequest) {
  return retiredResponse();
}
