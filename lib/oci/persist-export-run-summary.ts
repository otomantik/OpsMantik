import { adminClient } from '@/lib/supabase/admin';
import type { ScriptSummaryPayload } from '@/lib/oci/export-run-reconciliation';
import type { PersistSummaryStatus } from '@/lib/oci/export-run-summary-equations';

export type PersistExportRunSummaryInput = {
  siteId: string;
  providerKey: string;
  summary: ScriptSummaryPayload;
  status: PersistSummaryStatus;
  mismatch_reasons: string[];
  hashed_phone_csv_canary_active: boolean;
  fuse_stopped_reason: string | null;
  payload_redacted: Record<string, unknown>;
};

export type PersistExportRunSummaryResult =
  | { ok: true; summary_id: string }
  | { ok: false; error: string };

/**
 * Upsert aggregated counts — never raw PII / click ids / hashes.
 */
export async function persistExportRunSummary(input: PersistExportRunSummaryInput): Promise<PersistExportRunSummaryResult> {
  const exportRunId = String(input.summary.export_run_id ?? '').trim();
  if (!exportRunId) {
    return { ok: false, error: 'export_run_id required' };
  }

  const genAt = input.summary.generated_at ? new Date(input.summary.generated_at).toISOString() : null;
  const receivedAt = new Date().toISOString();
  const row = {
    export_run_id: exportRunId,
    site_id: input.siteId,
    provider_key: input.providerKey,
    source: 'google_ads_script',
    summary_version: input.summary.summary_version,
    generated_at: genAt,
    received_at: receivedAt,
    fetched_count: input.summary.fetched_count ?? 0,
    claimed_count: input.summary.claimed_count ?? 0,
    classified_uploadable_count: input.summary.classified_uploadable_count,
    classified_skipped_count: input.summary.classified_skipped_count,
    classified_failed_count: input.summary.classified_failed_count,
    upload_attempted_count: input.summary.upload_attempted_count,
    upload_success_count: input.summary.upload_success_count ?? 0,
    upload_failed_count: input.summary.upload_failed_count ?? 0,
    ack_success_count: input.summary.ack_success_count ?? 0,
    ack_failed_count: input.summary.ack_failed_count ?? 0,
    ack_skipped_count: input.summary.ack_skipped_count ?? 0,
    provider_ambiguous_pending_count: input.summary.provider_ambiguous_pending_count ?? 0,
    hashed_phone_csv_canary_active: input.hashed_phone_csv_canary_active,
    fuse_stopped_reason: input.fuse_stopped_reason,
    mismatch_reasons: input.mismatch_reasons,
    status: input.status,
    payload_redacted: input.payload_redacted,
    updated_at: receivedAt,
  };

  const { data, error } = await adminClient
    .from('oci_export_run_summaries')
    .upsert(row, { onConflict: 'export_run_id,site_id,provider_key' })
    .select('id')
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  const id = data && typeof data === 'object' && 'id' in data ? String((data as { id: string }).id) : '';
  if (!id) {
    return { ok: false, error: 'persist returned no id' };
  }
  return { ok: true, summary_id: id };
}
