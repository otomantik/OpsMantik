import type { ScriptSummaryPayload } from '@/lib/oci/export-run-reconciliation';

/**
 * Allowlisted summary metadata for JSONB storage — no click IDs, phone material, or hashes.
 */
export function buildPayloadRedacted(summary: ScriptSummaryPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {
    summary_version: summary.summary_version,
    export_run_id: summary.export_run_id,
    script_instance_id: summary.script_instance_id,
    provider_key: summary.provider_key,
    generated_at: summary.generated_at,
    fetched_count: summary.fetched_count,
    claimed_count: summary.claimed_count,
    classified_uploadable_count: summary.classified_uploadable_count,
    classified_skipped_count: summary.classified_skipped_count,
    classified_failed_count: summary.classified_failed_count,
    upload_attempted_count: summary.upload_attempted_count,
    upload_success_count: summary.upload_success_count,
    upload_failed_count: summary.upload_failed_count,
    provider_ambiguous_pending_count: summary.provider_ambiguous_pending_count,
    ack_success_count: summary.ack_success_count,
    ack_failed_count: summary.ack_failed_count,
    ack_skipped_count: summary.ack_skipped_count,
    external_id_count: summary.external_id_count,
    skipped_reasons: summary.skipped_reasons,
    failed_reasons: summary.failed_reasons,
  };
  for (const k of Object.keys(out)) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}
