-- OCI: Add UPLOADED status for bulk upload (asynchronous) path.
-- When AdsApp bulk upload apply() succeeds, we mark rows as UPLOADED (submitted, pending Google processing),
-- NOT COMPLETED. Row-level errors cannot be fetched via Scripts — check Google Ads UI > Tools > Uploads.

ALTER TABLE public.offline_conversion_queue DROP CONSTRAINT IF EXISTS offline_conversion_queue_status_check;
ALTER TABLE public.offline_conversion_queue
  ADD CONSTRAINT offline_conversion_queue_status_check
  CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRY', 'FATAL', 'UPLOADED'));

COMMENT ON CONSTRAINT offline_conversion_queue_status_check ON public.offline_conversion_queue IS
  'UPLOADED = CSV bulk upload submitted; awaiting Google processing. Row-level errors not available via Scripts.';
