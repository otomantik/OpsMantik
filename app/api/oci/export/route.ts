import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  return NextResponse.json(
    {
      error: 'Legacy OCI CSV export has been retired',
      code: 'LEGACY_OCI_EXPORT_RETIRED',
      canonical_route: '/api/oci/google-ads-export',
    },
    { status: 410 }
  );
}
