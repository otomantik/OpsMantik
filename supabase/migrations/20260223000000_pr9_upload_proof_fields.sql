-- =============================================================================
-- PR9: Upload proof fields on offline_conversion_queue.
-- Populated by worker: uploaded_at + provider_request_id on COMPLETED;
-- provider_error_code + provider_error_category on FAILED/RETRY.
-- =============================================================================

BEGIN;

ALTER TABLE public.offline_conversion_queue
  ADD COLUMN IF NOT EXISTS uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_request_id text,
  ADD COLUMN IF NOT EXISTS provider_error_code text,
  ADD COLUMN IF NOT EXISTS provider_error_category text;

COMMENT ON COLUMN public.offline_conversion_queue.uploaded_at IS 'PR9: When the conversion was successfully uploaded to the provider (set on COMPLETED).';
COMMENT ON COLUMN public.offline_conversion_queue.provider_request_id IS 'PR9: Provider correlation/request id if returned (e.g. from response headers).';
COMMENT ON COLUMN public.offline_conversion_queue.provider_error_code IS 'PR9: Standardized provider error code on FAILED/RETRY (e.g. INVALID_ARGUMENT, RATE_LIMIT).';
COMMENT ON COLUMN public.offline_conversion_queue.provider_error_category IS 'PR9: Error category on FAILED/RETRY: VALIDATION, AUTH, TRANSIENT, RATE_LIMIT.';

CREATE INDEX IF NOT EXISTS idx_offline_conversion_queue_uploaded_at
  ON public.offline_conversion_queue (site_id, provider_key, uploaded_at)
  WHERE uploaded_at IS NOT NULL;

COMMIT;
