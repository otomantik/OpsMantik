-- PR-9H.7F — Persist Google Ads Script export-run-summary (counts only; no PII).

BEGIN;

CREATE TABLE IF NOT EXISTS public.oci_export_run_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_run_id text NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites (id) ON DELETE CASCADE,
  provider_key text NOT NULL DEFAULT 'google_ads',
  source text NOT NULL DEFAULT 'google_ads_script',
  summary_version text NOT NULL,
  generated_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  fetched_count integer NOT NULL DEFAULT 0,
  claimed_count integer NOT NULL DEFAULT 0,
  classified_uploadable_count integer NOT NULL DEFAULT 0,
  classified_skipped_count integer NOT NULL DEFAULT 0,
  classified_failed_count integer NOT NULL DEFAULT 0,
  upload_attempted_count integer NOT NULL DEFAULT 0,
  upload_success_count integer NOT NULL DEFAULT 0,
  upload_failed_count integer NOT NULL DEFAULT 0,
  ack_success_count integer NOT NULL DEFAULT 0,
  ack_failed_count integer NOT NULL DEFAULT 0,
  ack_skipped_count integer NOT NULL DEFAULT 0,
  provider_ambiguous_pending_count integer NOT NULL DEFAULT 0,
  hashed_phone_csv_canary_active boolean NOT NULL DEFAULT false,
  fuse_stopped_reason text,
  mismatch_reasons text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL,
  payload_redacted jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oci_export_run_summaries_provider_non_empty CHECK (length(trim(provider_key)) > 0),
  CONSTRAINT oci_export_run_summaries_export_run_non_empty CHECK (length(trim(export_run_id)) > 0),
  CONSTRAINT oci_export_run_summaries_counts_nonneg CHECK (
    fetched_count >= 0 AND claimed_count >= 0 AND classified_uploadable_count >= 0 AND classified_skipped_count >= 0
    AND classified_failed_count >= 0 AND upload_attempted_count >= 0 AND upload_success_count >= 0 AND upload_failed_count >= 0
    AND ack_success_count >= 0 AND ack_failed_count >= 0 AND ack_skipped_count >= 0 AND provider_ambiguous_pending_count >= 0
  ),
  CONSTRAINT oci_export_run_summaries_status_allowed CHECK (
    status = ANY (
      ARRAY[
        'SCRIPT_SUMMARY_RECEIVED'::text,
        'SCRIPT_SUMMARY_RECONCILED'::text,
        'SCRIPT_SUMMARY_MISMATCH'::text,
        'SCRIPT_SUMMARY_REJECTED'::text
      ]
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS oci_export_run_summaries_run_site_provider_uidx
  ON public.oci_export_run_summaries (export_run_id, site_id, provider_key);

COMMENT ON TABLE public.oci_export_run_summaries IS
  'PR-9H.7F: Aggregated script export-run summary counts only; never store click IDs, phone hashes, or raw payloads.';

ALTER TABLE public.oci_export_run_summaries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.oci_export_run_summaries FROM PUBLIC;
REVOKE ALL ON TABLE public.oci_export_run_summaries FROM anon;
REVOKE ALL ON TABLE public.oci_export_run_summaries FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.oci_export_run_summaries TO service_role;

COMMIT;
