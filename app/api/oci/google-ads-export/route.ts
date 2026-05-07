import { NextRequest, NextResponse } from 'next/server';
import { formatSupabaseClientError } from '@/lib/oci/format-supabase-error';
import { logError, logInfo } from '@/lib/logging/logger';
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
    logInfo('EXPORT_RUN_STARTED', {
      export_run_id: auth.exportRunId,
      site_id: auth.siteUuid,
      provider_key: auth.providerFilter,
      markAsExported: auth.markAsExported,
      cursor: auth.queueCursorUpdatedAt,
      limit: auth.pageLimit,
    });

    const fetched = await fetchExportData(auth);
    logInfo('EXPORT_RUN_FETCHED', {
      export_run_id: auth.exportRunId,
      site_id: auth.siteUuid,
      fetched_count: fetched.rawList.length,
    });

    const built = await buildExportItems(auth, fetched);
    
    try {
      await markExportProcessing(auth, built);
      if (auth.markAsExported) {
        logInfo('EXPORT_RUN_CLAIMED', {
          export_run_id: auth.exportRunId,
          site_id: auth.siteUuid,
          claimed_count: built.keptConversions.length,
          suppressed_count: built.suppressedQueueIds.length,
          blocked_count: built.blockedQueueIds.length + built.blockedExportGateIds.length + built.blockedQueueTimeIds.length + built.blockedValueZeroIds.length + built.blockedExpiredIds.length,
        });
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'QUEUE_CLAIM_MISMATCH') {
        logInfo('EXPORT_RUN_CLAIM_MISMATCH', {
          export_run_id: auth.exportRunId,
          site_id: auth.siteUuid,
          status: 'FAIL',
        });
      }
      throw e;
    }
    const responseData = {
      data: built.combined,
      meta: {
        hasNextPage: Boolean(built.nextCursor),
        nextCursor: built.nextCursor,
      },
      siteId: auth.siteUuid,
      counts: {
        queued: built.keptConversions.length,
        signals: 0,
        pvs: 0,
        suppressed: built.suppressedQueueIds.length,
        adjustments: 0,
      },
      warnings: auth.isGhostCursor ? ['GHOST_CURSOR_FALLBACK_ACTIVE'] : [],
      // Backward-compatible fields (legacy script readers)
      items: built.combined,
      adjustments: [],
      next_cursor: built.nextCursor,
      markAsExported: auth.markAsExported,
      export_run_id: auth.exportRunId,
    };

    if (built.combined.length === 0) {
      logInfo('EXPORT_RUN_NO_ITEMS', {
        export_run_id: auth.exportRunId,
        site_id: auth.siteUuid,
      });
    } else {
      logInfo('EXPORT_RUN_RESPONSE_BUILT', {
        export_run_id: auth.exportRunId,
        site_id: auth.siteUuid,
        item_count: built.combined.length,
        next_cursor: built.nextCursor,
      });
    }

    return await buildExportResponseAsync(auth, responseData);
  } catch (e: unknown) {
    if (e instanceof ExportHttpError) {
      return NextResponse.json(e.body, { status: e.status });
    }
    if (e instanceof Error) {
      if (e.message === 'QUEUE_CLAIM_MISMATCH') {
        return NextResponse.json({ error: 'Queue claim mismatch', code: 'QUEUE_CLAIM_MISMATCH' }, { status: 409 });
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
