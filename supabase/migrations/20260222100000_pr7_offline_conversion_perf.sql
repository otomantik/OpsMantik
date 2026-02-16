-- PR7: Performance + determinism hardening.
-- 1) list_offline_conversion_groups returns queued_count, min_next_retry_at, min_created_at
-- 2) recover_stuck uses claimed_at (fallback updated_at); service_role guard
-- 3) Indexes for eligible scans and stuck recovery

BEGIN;

-- -----------------------------------------------------------------------------
-- list_offline_conversion_groups: add queued_count, min_next_retry_at, min_created_at
-- Eligible = status IN ('QUEUED','RETRY') AND (next_retry_at IS NULL OR next_retry_at <= now())
-- Must DROP first: PostgreSQL does not allow changing return type with CREATE OR REPLACE.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_offline_conversion_groups(int);

CREATE FUNCTION public.list_offline_conversion_groups(p_limit_groups int DEFAULT 50)
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
    WHERE oq.status IN ('QUEUED', 'RETRY')
      AND (oq.next_retry_at IS NULL OR oq.next_retry_at <= now())
    GROUP BY oq.site_id, oq.provider_key
    ORDER BY MIN(oq.next_retry_at) ASC NULLS FIRST, MIN(oq.created_at) ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit_groups, 50), 100))
  ) g;
END;
$$;

COMMENT ON FUNCTION public.list_offline_conversion_groups(int) IS
  'PR7: Distinct (site_id, provider_key) with queued_count and min times. service_role only. Backlog-weighted fair share.';

GRANT EXECUTE ON FUNCTION public.list_offline_conversion_groups(int) TO service_role;

-- -----------------------------------------------------------------------------
-- recover_stuck_offline_conversion_jobs: use claimed_at (fallback updated_at)
-- Only PROCESSING rows; move to RETRY (or QUEUED). Do not increment attempt_count.
-- Auth: service_role only (auth.role() check for consistency).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recover_stuck_offline_conversion_jobs(p_min_age_minutes int DEFAULT 15)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
  v_cutoff timestamptz := now() - (p_min_age_minutes || ' minutes')::interval;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'recover_stuck_offline_conversion_jobs may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  -- Stuck = PROCESSING and (claimed_at < cutoff) or (claimed_at is null and updated_at < cutoff)
  -- Enterprise semantics: move to RETRY (not QUEUED) so state = "recovered for retry"; next_retry_at=NULL => eligible immediately.
  WITH updated AS (
    UPDATE public.offline_conversion_queue q
    SET status = 'RETRY', next_retry_at = NULL, updated_at = now()
    WHERE q.status = 'PROCESSING'
      AND (q.claimed_at < v_cutoff OR (q.claimed_at IS NULL AND q.updated_at < v_cutoff))
    RETURNING q.id
  )
  SELECT count(*)::int INTO v_updated FROM updated;

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.recover_stuck_offline_conversion_jobs(int) IS
  'PR7: Moves PROCESSING rows with claimed_at (or updated_at) older than p_min_age_minutes to RETRY, next_retry_at=NULL (immediate re-claim). service_role only.';

GRANT EXECUTE ON FUNCTION public.recover_stuck_offline_conversion_jobs(int) TO service_role;

-- -----------------------------------------------------------------------------
-- Index for eligible scan: (site_id, provider_key, status, next_retry_at)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_offline_conversion_queue_eligible_scan
  ON public.offline_conversion_queue (site_id, provider_key, status, next_retry_at)
  WHERE status IN ('QUEUED', 'RETRY');

-- -----------------------------------------------------------------------------
-- Partial index for stuck recovery: claimed_at where status = PROCESSING
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_offline_conversion_queue_processing_claimed_at
  ON public.offline_conversion_queue (claimed_at)
  WHERE status = 'PROCESSING';

COMMIT;
