import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  return NextResponse.json(
    {
      error: 'Legacy OCI batch export has been retired',
      code: 'LEGACY_OCI_EXPORT_BATCH_RETIRED',
      canonical_route: '/api/oci/google-ads-export',
    },
    { status: 410 }
  );
}
