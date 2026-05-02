import { NextRequest, NextResponse } from 'next/server';
import { formatSupabaseClientError } from '@/lib/oci/format-supabase-error';
import { logError } from '@/lib/logging/logger';
import { authorizeExportRequest, ExportHttpError } from './export-auth';
import { fetchExportData } from './export-fetch';
import { buildExportItems } from './export-build-items';
import { markExportProcessing } from './export-mark-processing';
import { buildExportResponseAsync } from './export-response';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const auth = await authorizeExportRequest(req);
    const fetched = await fetchExportData(auth);
    const built = await buildExportItems(auth, fetched);
    await markExportProcessing(auth, built);
    const responseData = {
      data: built.combined,
      meta: {
        hasNextPage: Boolean(built.nextCursor),
        nextCursor: built.nextCursor,
      },
      siteId: auth.siteUuid,
      counts: {
        queued: built.keptConversions.length,
        signals: built.keptSignalItems.length,
        pvs: 0,
        suppressed: built.suppressedQueueIds.length + built.suppressedSignalIds.length,
        adjustments: 0,
      },
      warnings: auth.isGhostCursor ? ['GHOST_CURSOR_FALLBACK_ACTIVE'] : [],
      // Backward-compatible fields (legacy script readers)
      items: built.combined,
      adjustments: [],
      next_cursor: built.nextCursor,
      markAsExported: auth.markAsExported,
    };
    return await buildExportResponseAsync(auth, responseData);
  } catch (e: unknown) {
    if (e instanceof ExportHttpError) {
      return NextResponse.json(e.body, { status: e.status });
    }
    if (e instanceof Error) {
      if (e.message === 'QUEUE_CLAIM_MISMATCH') {
        return NextResponse.json({ error: 'Queue claim mismatch', code: 'QUEUE_CLAIM_MISMATCH' }, { status: 409 });
      }
      if (e.message === 'SIGNAL_CLAIM_MISMATCH') {
        return NextResponse.json({ error: 'Signal claim mismatch', code: 'SIGNAL_CLAIM_MISMATCH' }, { status: 409 });
      }
      if (e.message === 'SIGNAL_STATE_MISMATCH') {
        return NextResponse.json({ error: 'Signal state mismatch', code: 'SIGNAL_STATE_MISMATCH' }, { status: 409 });
      }
      if (e.message === 'SERVER_ERROR') {
        return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
      }
    }
    const details = formatSupabaseClientError(e);
    logError('OCI_EXPORT_FATAL', { error: details });
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}
