/**
 * GET /api/truth/explain/[callId]
 * Read-only aggregation of shadow truth tables for a call (no PII in response).
 * Auth: Supabase session + validateSiteAccess(call.site_id).
 * Gated by EXPLAINABILITY_API_ENABLED (404 when off).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { getRefactorFlags } from '@/lib/refactor/flags';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { REFACTOR_PHASE_TAG } from '@/lib/version';
import { getBuildInfoHeaders } from '@/lib/build-info';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ callId: string }> }
) {
  const { callId } = await context.params;
  if (!callId || !/^[0-9a-f-]{36}$/i.test(callId)) {
    return NextResponse.json({ error: 'invalid_call_id' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  if (!getRefactorFlags().explainability_api_enabled) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: getBuildInfoHeaders() });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: getBuildInfoHeaders() });
  }

  const { data: callRow, error: callErr } = await adminClient
    .from('calls')
    .select('id, site_id, status, lead_score, created_at')
    .eq('id', callId)
    .maybeSingle();

  if (callErr || !callRow?.site_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: getBuildInfoHeaders() });
  }

  const access = await validateSiteAccess(callRow.site_id, user.id, supabase);
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: getBuildInfoHeaders() });
  }

  const siteId = callRow.site_id;

  const [
    evidenceRes,
    inferenceRes,
    projectionRes,
    identityRes,
    signalsRes,
  ] = await Promise.all([
    adminClient
      .from('truth_evidence_ledger')
      .select('id, evidence_kind, ingest_source, schema_version, ingested_at, occurred_at, payload')
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .order('ingested_at', { ascending: false })
      .limit(25),
    adminClient
      .from('truth_inference_runs')
      .select('id, inference_kind, policy_version, engine_version, occurred_at, output_summary')
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .order('created_at', { ascending: false })
      .limit(25),
    adminClient
      .from('call_funnel_projection')
      .select(
        'call_id, highest_stage, current_stage, export_status, funnel_completeness, v2_at, v5_at, updated_at'
      )
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .maybeSingle(),
    adminClient
      .from('truth_identity_graph_edges')
      .select('id, edge_kind, ingest_source, fingerprint_digest, session_id, created_at')
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .order('created_at', { ascending: false })
      .limit(25),
    adminClient
      .from('marketing_signals')
      .select('id, google_conversion_name, dispatch_status, causal_dna, created_at')
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  incrementRefactorMetric('explainability_api_probe_total');

  return NextResponse.json(
    {
      explainability_version: '1',
      refactor_phase: REFACTOR_PHASE_TAG,
      call: {
        id: callRow.id,
        status: callRow.status,
        lead_score: callRow.lead_score,
        created_at: callRow.created_at,
      },
      truth_evidence_ledger: evidenceRes.error
        ? { error: 'unavailable' }
        : { rows: evidenceRes.data ?? [] },
      truth_inference_runs: inferenceRes.error
        ? { error: 'unavailable' }
        : { rows: inferenceRes.data ?? [] },
      call_funnel_projection: projectionRes.error
        ? { error: 'unavailable' }
        : { row: projectionRes.data ?? null },
      truth_identity_graph_edges: identityRes.error
        ? { error: 'unavailable' }
        : { rows: identityRes.data ?? [] },
      marketing_signals: signalsRes.error
        ? { error: 'unavailable' }
        : { rows: signalsRes.data ?? [] },
    },
    { headers: { ...getBuildInfoHeaders(), 'Cache-Control': 'no-store' } }
  );
}
