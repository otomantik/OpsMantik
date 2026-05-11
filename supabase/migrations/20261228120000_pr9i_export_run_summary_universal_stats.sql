-- PR-9I — Universal Script Drain: extra aggregated counters (no PII).

BEGIN;

ALTER TABLE public.oci_export_run_summaries
  ADD COLUMN IF NOT EXISTS selected_gclid_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS selected_wbraid_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS selected_gbraid_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS multiple_click_ids_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hashed_phone_attached_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hashed_phone_only_rejected_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS missing_click_id_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invalid_time_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_validation_failed_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.oci_export_run_summaries.selected_gclid_count IS 'PR-9I: rows uploaded with chosen identifier gclid.';
COMMENT ON COLUMN public.oci_export_run_summaries.multiple_click_ids_count IS 'PR-9I: rows where >1 click id was present; single column populated by priority.';

COMMIT;
