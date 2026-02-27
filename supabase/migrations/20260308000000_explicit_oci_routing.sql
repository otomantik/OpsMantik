-- =============================================================================
-- Enterprise OCI Routing: API (Push) vs Script (Pull)
-- Partitioning the queue to prevent worker conflicts.
-- =============================================================================

BEGIN;

-- 1. Add oci_sync_method to sites
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'oci_sync_method') THEN
        CREATE TYPE public.oci_sync_method AS ENUM ('api', 'script');
    END IF;
END $$;

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS oci_sync_method public.oci_sync_method DEFAULT 'script';

COMMENT ON COLUMN public.sites.oci_sync_method IS 
  'Explicit routing for OCI: api (backend worker push) or script (Google Ads Script pull).';

-- 2. Intelligent Defaults: Site has active credentials -> api, else script
UPDATE public.sites s
SET oci_sync_method = 'api'
WHERE EXISTS (
    SELECT 1 FROM public.provider_credentials pc 
    WHERE pc.site_id = s.id 
      AND pc.provider_key = 'google_ads' 
      AND pc.is_active = true
      AND pc.encrypted_payload IS NOT NULL
);

-- 3. Update list_offline_conversion_groups to respect sync method
-- Only sites with oci_sync_method = 'api' are processed by the backend worker.
DROP FUNCTION IF EXISTS public.list_offline_conversion_groups(int);

CREATE OR REPLACE FUNCTION public.list_offline_conversion_groups(p_limit_groups int DEFAULT 50)
RETURNS TABLE(
  site_id uuid,
  provider_key text,
  queued_count bigint,
  min_next_retry_at timestamptz,
  min_created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'list_offline_conversion_groups may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT g.site_id, g.provider_key, g.queued_count, g.min_next_retry_at, g.min_created_at
  FROM (
    SELECT oq.site_id, oq.provider_key,
           count(*)::bigint AS queued_count,
           MIN(oq.next_retry_at) AS min_next_retry_at,
           MIN(oq.created_at) AS min_created_at
    FROM public.offline_conversion_queue oq
    JOIN public.sites s ON s.id = oq.site_id
    WHERE oq.status IN ('QUEUED', 'RETRY')
      AND (oq.next_retry_at IS NULL OR oq.next_retry_at <= now())
      AND s.oci_sync_method = 'api'
    GROUP BY oq.site_id, oq.provider_key
    ORDER BY MIN(oq.next_retry_at) ASC NULLS FIRST, MIN(oq.created_at) ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit_groups, 50), 100))
  ) g;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_offline_conversion_groups(int) TO service_role;

-- 4. Update claim_offline_conversion_jobs_v2 to respect sync method (Safety Guard)
CREATE OR REPLACE FUNCTION public.claim_offline_conversion_jobs_v2(
  p_site_id uuid,
  p_provider_key text,
  p_limit int DEFAULT 50
)
RETURNS SETOF public.offline_conversion_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'claim_offline_conversion_jobs_v2 may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));

  RETURN QUERY
  UPDATE public.offline_conversion_queue q
  SET status = 'PROCESSING', claimed_at = now(), updated_at = now()
  FROM (
    SELECT oq.id
    FROM public.offline_conversion_queue oq
    JOIN public.sites s ON s.id = oq.site_id
    WHERE oq.site_id = p_site_id
      AND oq.provider_key = p_provider_key
      AND oq.status IN ('QUEUED', 'RETRY')
      AND (oq.next_retry_at IS NULL OR oq.next_retry_at <= now())
      AND s.oci_sync_method = 'api'
    ORDER BY oq.next_retry_at ASC NULLS FIRST, oq.created_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ) sub
  WHERE q.id = sub.id
  RETURNING q.*;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_offline_conversion_jobs_v2(uuid, text, int) TO service_role;

COMMIT;
