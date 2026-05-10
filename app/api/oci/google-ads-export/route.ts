import { NextRequest, NextResponse } from 'next/server';
import { formatSupabaseClientError } from '@/lib/oci/format-supabase-error';
import { logError, logInfo } from '@/lib/logging/logger';
import { authorizeExportRequest, ExportHttpError } from './export-auth';
import { fetchExportData } from './export-fetch';
import { buildExportItems } from './export-build-items';
import { buildPreviewDiagnosticsExtension } from './export-preview-diagnostics';
import { markExportProcessing } from './export-mark-processing';
import { buildExportResponseAsync } from './export-response';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Non-sensitive tail for diagnostics (PR-9H.4F.1 hosted parity). */
function uuidTail(id: string | null | undefined): string | null {
  if (!id) return null;
  const compact = String(id).replace(/-/g, '');
  return compact.length >= 8 ? compact.slice(-8) : compact || null;
}

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
    const skipReasonCounts = {
      call_not_sendable: built.callNotSendableQueueIds.length,
      export_gate_call_id_required: built.blockedExportGateIds.length,
      missing_currency: built.blockedCurrencyIds.length,
      missing_conversion_action: built.blockedMissingConversionActionIds.length,
      invalid_conversion_time: built.blockedQueueTimeIds.length,
      invalid_value: built.blockedValueZeroIds.length + built.blockedExpiredIds.length,
      suppressed_by_higher_gear: built.suppressedQueueIds.length,
    };
    const skippedCount = Object.values(skipReasonCounts).reduce((acc, n) => acc + n, 0);

    const previewExtension = auth.markAsExported
      ? null
      : buildPreviewDiagnosticsExtension(
          fetched.rawList,
          {
            suppressedQueueIds: built.suppressedQueueIds,
            blockedQueueTimeIds: built.blockedQueueTimeIds,
            blockedValueZeroIds: built.blockedValueZeroIds,
            blockedExpiredIds: built.blockedExpiredIds,
            blockedExportGateIds: built.blockedExportGateIds,
            blockedMissingConversionActionIds: built.blockedMissingConversionActionIds,
            combined: built.combined,
          },
          built.pipelineStats,
          built.callNotSendableQueueIds,
          built.hashedPhoneDiagnostics,
          built.currencyDiagnostics
        );
    
    try {
      await markExportProcessing(auth, built);
      if (auth.markAsExported) {
        logInfo('EXPORT_RUN_CLAIMED', {
          export_run_id: auth.exportRunId,
          site_id: auth.siteUuid,
          claimed_count: built.keptConversions.length,
          suppressed_count: built.suppressedQueueIds.length,
          blocked_count:
            built.blockedQueueIds.length +
            built.blockedExportGateIds.length +
            built.blockedMissingConversionActionIds.length +
            built.blockedQueueTimeIds.length +
            built.blockedValueZeroIds.length +
            built.blockedExpiredIds.length,
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
    if (!auth.markAsExported && previewExtension) {
      Object.assign(responseData, {
        preview_diagnostics: {
          fetched_count: fetched.rawList.length,
          built_count: previewExtension.built_count,
          buildable_count: built.keptConversions.length + built.suppressedQueueIds.length,
          returned_count: built.combined.length,
          skipped_count: skippedCount,
          skip_reason_counts: skipReasonCounts,
          pipeline_stats: previewExtension.pipeline_stats,
          skip_by_action: previewExtension.skip_by_action,
          skip_by_status: previewExtension.skip_by_status,
          skip_by_click_id_availability: previewExtension.skip_by_click_id_availability,
          skip_by_reason_detail: previewExtension.skip_by_reason_detail,
          skip_by_provider_path: previewExtension.skip_by_provider_path,
          signal_availability_counts: previewExtension.signal_availability_counts,
          script_v1_supported_counts: previewExtension.script_v1_supported_counts,
          api_supported_counts: previewExtension.api_supported_counts,
          returned_action_counts: previewExtension.returned_action_counts,
          hashed_phone_available_count: previewExtension.hashed_phone_available_count,
          hashed_phone_invalid_count: previewExtension.hashed_phone_invalid_count,
          hashed_phone_candidate_count: previewExtension.hashed_phone_candidate_count,
          hashed_phone_exported_count: previewExtension.hashed_phone_exported_count,
          hashed_phone_missing_count: previewExtension.hashed_phone_missing_count,
          hashed_phone_source_counts: previewExtension.hashed_phone_source_counts,
          enhanced_signal_available_count: previewExtension.enhanced_signal_available_count,
          currency_missing_count: previewExtension.currency_missing_count,
          currency_unexpected_count: previewExtension.currency_unexpected_count,
          currency_defaulted_count: previewExtension.currency_defaulted_count,
          provider_key_filter: auth.providerFilter,
          page_limit: auth.pageLimit,
          site_id_filter_suffix: uuidTail(auth.siteUuid),
          status_filter: ['QUEUED', 'RETRY'],
          cursor_received: Boolean(auth.queueCursorUpdatedAt && auth.queueCursorId),
          next_cursor_present: Boolean(built.nextCursor),
          allowlist_contract: {
            parsed_allowlist_count: auth.canaryAllowlistIds.length,
            allowlist_query_seen: auth.canaryAllowlistQuerySeen,
            allowlist_header_seen: auth.canaryAllowlistHeaderSeen,
            applied_to_fetch: auth.canaryMode && auth.canaryAllowlistIds.length > 0,
            expected_queue_id_suffix: uuidTail(auth.canaryExpectedQueueId),
            first_fetched_queue_id_suffix:
              fetched.rawList[0]?.id != null ? uuidTail(String(fetched.rawList[0].id)) : null,
          },
        },
      });
    } else {
      Object.assign(responseData, {
        live_diagnostics: {
          fetched_count: fetched.rawList.length,
          claimed_count: built.keptConversions.length,
          returned_item_count: built.combined.length,
          skipped_count: skippedCount,
          skip_reason_counts: skipReasonCounts,
          hashed_phone_candidate_count: built.hashedPhoneDiagnostics.hashed_phone_candidate_count,
          hashed_phone_exported_count: built.hashedPhoneDiagnostics.hashed_phone_exported_count,
          hashed_phone_missing_count: built.hashedPhoneDiagnostics.hashed_phone_missing_count,
          hashed_phone_invalid_count: built.hashedPhoneDiagnostics.hashed_phone_invalid_count,
          hashed_phone_source_counts: built.hashedPhoneDiagnostics.hashed_phone_source_counts,
        },
      });
    }

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

    const res = await buildExportResponseAsync(auth, responseData);
    res.headers.set('Cache-Control', 'private, no-store, must-revalidate');
    res.headers.set('CDN-Cache-Control', 'no-store');
    res.headers.set('Vary', 'x-api-key, Authorization, x-opsmantik-allowlist-ids');
    return res;
  } catch (e: unknown) {
    if (e instanceof ExportHttpError) {
      return NextResponse.json(e.body, { status: e.status });
    }
    if (e instanceof Error) {
      if (e.message === 'CANARY_EXPORT_BLOCKED') {
        return NextResponse.json({ error: 'Canary export blocked', code: 'CANARY_EXPORT_BLOCKED' }, { status: 409 });
      }
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
