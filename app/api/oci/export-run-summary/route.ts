import { NextRequest, NextResponse } from 'next/server';
import { logError, logInfo } from '@/lib/logging/logger';
import { assertLaneActive } from '@/lib/oci/kill-switch';
import { validateScriptSummaryShape, evaluateReconciliation } from '@/lib/oci/export-run-reconciliation';
import { resolveOciScriptAuth } from '@/lib/oci/script-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
        { ok: false, export_run_integrity: 'EXPORT_RUN_INTEGRITY_RED', error: 'SCRIPT_SUMMARY_INVALID', details: { message: error } },
        { status: 400 }
      );
    }

    // Only attempt auth check if they passed siteId (or if we require it via headers? Auth logic takes care of it)
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

    const evaluation = evaluateReconciliation(summary);

    if (!evaluation.ok) {
      logError('SCRIPT_SUMMARY_MISMATCH', {
        site_id: siteUuid,
        export_run_id: summary.export_run_id,
        mismatch_reasons: evaluation.mismatch_reasons,
        reconciliation_status: evaluation.reconciliation_status
      });
      return NextResponse.json(evaluation, { status: 409 });
    }

    logInfo('SCRIPT_SUMMARY_RECEIVED', {
      site_id: siteUuid,
      export_run_id: summary.export_run_id,
      reconciliation_status: evaluation.reconciliation_status,
      mismatch_reasons: evaluation.mismatch_reasons
    });

    return NextResponse.json(evaluation);
  } catch (e: unknown) {
    logError('OCI_SUMMARY_ERROR', { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json(
      { error: 'Summary request could not be processed', code: 'SUMMARY_PROCESSING_ERROR', retryable: true },
      { status: 503 }
    );
  }
}
