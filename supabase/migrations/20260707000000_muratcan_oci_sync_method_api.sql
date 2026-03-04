-- Phase Two: Database Configuration — Route Muratcan AKÜ OCI to Worker (api).
-- list_offline_conversion_groups / claim_offline_conversion_jobs_v2 only process sites with oci_sync_method = 'api'.
-- RECON (run manually before/after if desired):
--   SELECT id, name, oci_sync_method FROM sites WHERE id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073';

BEGIN;

UPDATE public.sites
SET oci_sync_method = 'api'
WHERE id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'
  AND (oci_sync_method IS DISTINCT FROM 'api');

COMMIT;
