/**
 * Phase 4 — Shadow dual-read between calls (legacy) and call_funnel_projection (kernel).
 * Gated by TRUTH_PROJECTION_READ_ENABLED; never throws; does not change export/OCI paths.
 */

import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';
import { getRefactorFlags } from '@/lib/refactor/flags';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { processCallProjection } from '@/lib/domain/funnel-kernel/projection-updater';

const STAGES = new Set(['V2', 'V3', 'V4', 'V5']);

/**
 * After a V2_CONTACT ledger append, optionally rebuild projection and verify read-model alignment.
 * Fire-and-forget from ingest (void); RPC + reads only when flag is on.
 */
export async function probeFunnelProjectionDualRead(
  siteId: string,
  callId: string,
  ingestSource: 'call_event' | 'sync'
): Promise<void> {
  if (!getRefactorFlags().truth_projection_read_enabled) return;

  incrementRefactorMetric('truth_projection_read_probe_total');

  try {
    await processCallProjection(callId, siteId);
  } catch {
    /* projection RPC may fail in dev or under load — still read below */
  }

  const { data: proj, error: projErr } = await adminClient
    .from('call_funnel_projection')
    .select('highest_stage, export_status, current_stage')
    .eq('call_id', callId)
    .eq('site_id', siteId)
    .maybeSingle();

  if (projErr) {
    logWarn('TRUTH_PROJECTION_DUAL_READ', {
      ingest_source: ingestSource,
      call_id: callId,
      site_id: siteId,
      error: projErr.message,
    });
    return;
  }

  const { data: callRow, error: callErr } = await adminClient
    .from('calls')
    .select('status, lead_score')
    .eq('id', callId)
    .eq('site_id', siteId)
    .maybeSingle();

  if (callErr || !callRow) {
    logWarn('TRUTH_PROJECTION_DUAL_READ', {
      ingest_source: ingestSource,
      call_id: callId,
      site_id: siteId,
      error: callErr?.message ?? 'call_row_missing',
    });
    return;
  }

  if (!proj) {
    incrementRefactorMetric('truth_projection_drift_total');
    logWarn('TRUTH_PROJECTION_DRIFT', {
      ingest_source: ingestSource,
      call_id: callId,
      site_id: siteId,
      kind: 'projection_row_missing_after_rebuild',
    });
    return;
  }

  if (!STAGES.has(proj.highest_stage)) {
    incrementRefactorMetric('truth_projection_drift_total');
    logWarn('TRUTH_PROJECTION_DRIFT', {
      ingest_source: ingestSource,
      call_id: callId,
      site_id: siteId,
      kind: 'unexpected_highest_stage',
      highest_stage: proj.highest_stage,
    });
  }
}
