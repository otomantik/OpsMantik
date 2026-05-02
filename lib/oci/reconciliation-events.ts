/**
 * Append-only audit for OCI reconciliation / skipped writes (idempotent via DB unique index).
 */

import { adminClient } from '@/lib/supabase/admin';
import { buildOciEvidenceHash } from '@/lib/oci/evidence-hash';
import type { OciReconciliationReason } from '@/lib/oci/reconciliation-reasons';

export async function appendOciReconciliationEvent(params: {
  siteId: string;
  callId: string | null;
  stage: string;
  reason: OciReconciliationReason;
  matchedSessionId?: string | null;
  primaryClickIdPresent?: boolean;
  expectedConversionName?: string | null;
  result?: string;
  payload?: Record<string, unknown>;
}): Promise<{ inserted: boolean }> {
  const evidenceHash = buildOciEvidenceHash({
    siteId: params.siteId,
    callId: params.callId,
    stage: params.stage,
    reason: params.reason,
    matchedSessionId: params.matchedSessionId,
    primaryClickIdPresent: params.primaryClickIdPresent ?? false,
  });

  const { error } = await adminClient.from('oci_reconciliation_events').insert({
    site_id: params.siteId,
    call_id: params.callId,
    stage: params.stage,
    reason: params.reason,
    expected_conversion_name: params.expectedConversionName ?? null,
    result: params.result ?? 'skipped',
    evidence_hash: evidenceHash,
    payload: params.payload ?? {},
  });

  const code = (error as { code?: string } | null)?.code;
  if (code === '23505') {
    return { inserted: false };
  }
  if (error) {
    throw error;
  }
  return { inserted: true };
}
