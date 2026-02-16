-- Recover jobs stuck in PROCESSING (e.g. worker crash). Move to QUEUED so they can be re-claimed.
-- Service_role only. Called by cron /api/cron/providers/recover-processing.

BEGIN;

CREATE OR REPLACE FUNCTION public.recover_stuck_offline_conversion_jobs(p_min_age_minutes int DEFAULT 15)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'recover_stuck_offline_conversion_jobs may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  -- Only status + updated_at; do NOT increment retry_count. Preserve attempt count so retry logic proceeds naturally on re-claim.
  WITH updated AS (
    UPDATE public.offline_conversion_queue q
    SET status = 'QUEUED', updated_at = now()
    WHERE q.status = 'PROCESSING'
      AND q.updated_at < now() - (p_min_age_minutes || ' minutes')::interval
    RETURNING q.id
  )
  SELECT count(*)::int INTO v_updated FROM updated;

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.recover_stuck_offline_conversion_jobs(int) IS
  'Moves PROCESSING rows older than p_min_age_minutes to QUEUED for re-claim. Service_role only.';

GRANT EXECUTE ON FUNCTION public.recover_stuck_offline_conversion_jobs(int) TO service_role;

COMMIT;
