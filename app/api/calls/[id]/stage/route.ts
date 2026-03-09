/**
 * POST /api/calls/[id]/stage
 *
 * Retired to prevent split-brain writes. Calls must flow through the DB-owned
 * call state machine (`/api/calls/[id]/seal`, `/api/intents/[id]/status`) only.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  _ctx: { params: Promise<{ id: string }> }
) {
  return NextResponse.json(
    {
      error: 'Legacy pipeline stage route has been retired',
      code: 'PIPELINE_STAGE_ROUTE_RETIRED',
      canonical_routes: [
        '/api/calls/[id]/seal',
        '/api/intents/[id]/status',
      ],
    },
    { status: 410 }
  );
}
