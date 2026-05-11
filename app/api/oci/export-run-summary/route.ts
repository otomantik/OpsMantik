import { NextRequest, NextResponse } from 'next/server';
import { logError, logInfo } from '@/lib/logging/logger';
import { assertLaneActive } from '@/lib/oci/kill-switch';
import { validateScriptSummaryShape } from '@/lib/oci/export-run-reconciliation';
import { resolveOciScriptAuth } from '@/lib/oci/script-auth';
import {
  derivePersistStatus,
  evaluatePersistEquations,
  normalizeSummaryForPersist,
} from '@/lib/oci/export-run-summary-equations';
import { persistExportRunSummary } from '@/lib/oci/persist-export-run-summary';
import { buildPayloadRedacted } from '@/lib/oci/export-run-summary-payload-redacted';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function compactCounts(summary: ReturnType<typeof normalizeSummaryForPersist>) {
  return {
    fetched_count: summary.fetched_count,
    claimed_count: summary.claimed_count ?? 0,
    classified_uploadable_count: summary.classified_uploadable_count,
    classified_skipped_count: summary.classified_skipped_count,
    classified_failed_count: summary.classified_failed_count,
    upload_attempted_count: summary.upload_attempted_count,
    upload_success_count: summary.upload_success_count ?? 0,
    upload_failed_count: summary.upload_failed_count ?? 0,
    provider_ambiguous_pending_count: summary.provider_ambiguous_pending_count ?? 0,
    ack_success_count: summary.ack_success_count ?? 0,
    ack_failed_count: summary.ack_failed_count ?? 0,
    ack_skipped_count: summary.ack_skipped_count ?? 0,
  };
}

export async function POST(req: NextRequest) {
  try {
    const lane = assertLaneActive('OCI_ACK');
    if (!lane.ok) {
      return NextResponse.json({ error: 'OCI ACK paused', code: lane.code }, { status: 503 });
    }

    let bodyUnknown: unknown;
    try {
      bodyUnknown = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'BAD_REQUEST' }, { status: 400 });
    }

    const { ok: validShape, summary, error } = validateScriptSummaryShape(bodyUnknown);
    if (!validShape || !summary) {
      logError('SCRIPT_SUMMARY_INVALID', { error });
      return NextResponse.json(
        {
          ok: false,
          persisted: false,
          export_run_integrity: 'EXPORT_RUN_INTEGRITY_RED',
          error: 'SCRIPT_SUMMARY_INVALID',
          details: { message: error },
        },
        { status: 400 }
      );
    }

    const siteIdFromBody = (bodyUnknown as { siteId?: string }).siteId;
    const auth = await resolveOciScriptAuth({
      req,
      siteIdFromBody,
      authFailNamespace: 'oci-summary-authfail',
    });
    if (!auth.ok) {
      return auth.response;
    }

    const siteUuid = auth.siteUuid;
    const root = bodyUnknown as Record<string, unknown>;
    const hashed_phone_csv_canary_active = root.hashed_phone_csv_canary_active === true;
    const fuse_stopped_reason =
      typeof root.fuse_stopped_reason === 'string' && root.fuse_stopped_reason.trim()
        ? String(root.fuse_stopped_reason).trim().slice(0, 500)
        : null;
    const providerKey =
      typeof summary.provider_key === 'string' && summary.provider_key.trim()
        ? summary.provider_key.trim()
        : 'google_ads';

    const normalized = normalizeSummaryForPersist(summary);
    const eq = evaluatePersistEquations(normalized);
    const payload_redacted = buildPayloadRedacted(normalized);
    const script_summary_status = derivePersistStatus({
      shapeOk: true,
      mismatch_reasons: eq.mismatch_reasons,
      partial_evidence: eq.partial_evidence,
    });

    const persist = await persistExportRunSummary({
      siteId: siteUuid,
      providerKey,
      summary: normalized,
      status: script_summary_status,
      mismatch_reasons: eq.mismatch_reasons.map(String),
      hashed_phone_csv_canary_active,
      fuse_stopped_reason,
      payload_redacted,
    });

    if (!persist.ok) {
      logError('SCRIPT_SUMMARY_PERSIST_FAILED', { site_id: siteUuid, error: persist.error });
      return NextResponse.json(
        {
          ok: false,
          persisted: false,
          script_summary_status: 'SCRIPT_SUMMARY_REJECTED',
          export_run_id: normalized.export_run_id,
          code: 'SUMMARY_PERSIST_FAILED',
          retryable: true,
        },
        { status: 503 }
      );
    }

    const payload = {
      ok: true,
      persisted: true,
      script_summary_status,
      export_run_id: normalized.export_run_id,
      summary_id: persist.summary_id,
      mismatch_reasons: eq.mismatch_reasons,
      counts: compactCounts(normalized),
      partial_evidence: eq.partial_evidence,
      equation_checks: {
        checked_a: eq.checked_a,
        checked_b: eq.checked_b,
        checked_c: eq.checked_c,
        checked_d: eq.checked_d,
        checked_e: eq.checked_e,
        checked_f: eq.checked_f,
        checked_g: eq.checked_g,
        checked_h: eq.checked_h,
      },
    };

    if (script_summary_status === 'SCRIPT_SUMMARY_MISMATCH') {
      logError('SCRIPT_SUMMARY_MISMATCH', {
        site_id: siteUuid,
        export_run_id: normalized.export_run_id,
        mismatch_reasons: eq.mismatch_reasons,
      });
    } else {
      logInfo('SCRIPT_SUMMARY_RECEIVED', {
        site_id: siteUuid,
        export_run_id: normalized.export_run_id,
        script_summary_status,
        mismatch_reasons: eq.mismatch_reasons,
      });
    }

    return NextResponse.json(payload, { status: 200 });
  } catch (e: unknown) {
    logError('OCI_SUMMARY_ERROR', { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json(
      { error: 'Summary request could not be processed', code: 'SUMMARY_PROCESSING_ERROR', retryable: true },
      { status: 503 }
    );
  }
}
