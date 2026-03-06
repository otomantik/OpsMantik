-- next_retry_at was defined NOT NULL DEFAULT now() (20260218140000_process_offline_conversions_worker.sql).
-- apply_oci_queue_transition_snapshot sets it to NULL when 'next_retry_at' is in clear_fields
-- (e.g. UPLOADED / COMPLETED transitions via append_script_transition_batch).
-- This violated the NOT NULL constraint and caused a 500 on /api/oci/ack.
--
-- Fix: drop NOT NULL. Terminal rows (UPLOADED/COMPLETED) have no meaningful next_retry.
-- The claim query (claim_offline_conversion_jobs_v2) already filters status IN ('QUEUED','RETRY'),
-- so NULL next_retry_at on terminal rows is harmless.

BEGIN;

ALTER TABLE public.offline_conversion_queue
  ALTER COLUMN next_retry_at DROP NOT NULL;

COMMIT;
