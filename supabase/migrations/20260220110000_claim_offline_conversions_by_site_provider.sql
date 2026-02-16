-- PR6: Provider-aware claim by (site_id, provider_key) + deterministic ordering.
-- Adds claimed_at, list_offline_conversion_groups, and claim_offline_conversion_jobs_v2(site_id, provider_key, limit) overload.

BEGIN;

ALTER TABLE public.offline_conversion_queue
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

COMMENT ON COLUMN public.offline_conversion_queue.claimed_at IS 'Set when row is claimed by worker (PR6).';

-- List distinct (site_id, provider_key) that have at least one eligible row. Deterministic order for fair processing.
-- Status set: QUEUED and RETRY are both first-class (G4); eligible = (next_retry_at IS NULL OR next_retry_at <= now()).
CREATE OR REPLACE FUNCTION public.list_offline_conversion_groups(p_limit_groups int DEFAULT 50)
RETURNS TABLE(site_id uuid, provider_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'list_offline_conversion_groups may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT g.site_id, g.provider_key
  FROM (
    SELECT oq.site_id, oq.provider_key,
           MIN(oq.next_retry_at) AS min_retry,
           MIN(oq.created_at) AS min_created
    FROM public.offline_conversion_queue oq
    WHERE oq.status IN ('QUEUED', 'RETRY')
      AND (oq.next_retry_at IS NULL OR oq.next_retry_at <= now())
    GROUP BY oq.site_id, oq.provider_key
    ORDER BY MIN(oq.next_retry_at) ASC NULLS FIRST, MIN(oq.created_at) ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit_groups, 50), 100))
  ) g;
END;
$$;

COMMENT ON FUNCTION public.list_offline_conversion_groups(int) IS
  'PR6: Distinct (site_id, provider_key) with eligible QUEUED/RETRY rows. service_role only.';

GRANT EXECUTE ON FUNCTION public.list_offline_conversion_groups(int) TO service_role;

-- Per-group claim: strict site_id + provider_key scoping, deterministic order, FOR UPDATE SKIP LOCKED.
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
    WHERE oq.site_id = p_site_id
      AND oq.provider_key = p_provider_key
      AND oq.status IN ('QUEUED', 'RETRY')
      AND (oq.next_retry_at IS NULL OR oq.next_retry_at <= now())
    ORDER BY oq.next_retry_at ASC NULLS FIRST, oq.created_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ) sub
  WHERE q.id = sub.id
  RETURNING q.*;
END;
$$;

COMMENT ON FUNCTION public.claim_offline_conversion_jobs_v2(uuid, text, int) IS
  'PR6: Claim jobs for one (site_id, provider_key). ORDER BY next_retry_at NULLS FIRST, created_at. service_role only.';

GRANT EXECUTE ON FUNCTION public.claim_offline_conversion_jobs_v2(uuid, text, int) TO service_role;

COMMIT;
