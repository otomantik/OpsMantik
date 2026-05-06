BEGIN;

CREATE TABLE IF NOT EXISTS public.cron_job_heartbeats (
  job_name text PRIMARY KEY,
  scheduler_type text NOT NULL DEFAULT 'vercel_cron',
  route_path text NOT NULL,
  last_started_at timestamptz NULL,
  last_finished_at timestamptz NULL,
  last_status text NOT NULL DEFAULT 'UNKNOWN',
  last_duration_ms integer NULL,
  last_rows_affected integer NULL,
  last_error_code text NULL,
  last_error_message text NULL,
  run_count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (last_status IN ('UNKNOWN', 'RUNNING', 'PASS', 'PARTIAL', 'FAIL'))
);

CREATE OR REPLACE FUNCTION public.upsert_cron_job_heartbeat(
  p_job_name text,
  p_scheduler_type text,
  p_route_path text,
  p_status text,
  p_started_at timestamptz DEFAULT NULL,
  p_finished_at timestamptz DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL,
  p_rows_affected integer DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS public.cron_job_heartbeats
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.cron_job_heartbeats;
BEGIN
  IF p_job_name IS NULL OR btrim(p_job_name) = '' THEN
    RAISE EXCEPTION 'CRON_HEARTBEAT_JOB_NAME_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_route_path IS NULL OR btrim(p_route_path) = '' THEN
    RAISE EXCEPTION 'CRON_HEARTBEAT_ROUTE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('UNKNOWN', 'RUNNING', 'PASS', 'PARTIAL', 'FAIL') THEN
    RAISE EXCEPTION 'CRON_HEARTBEAT_INVALID_STATUS' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.cron_job_heartbeats (
    job_name,
    scheduler_type,
    route_path,
    last_started_at,
    last_finished_at,
    last_status,
    last_duration_ms,
    last_rows_affected,
    last_error_code,
    last_error_message,
    run_count,
    updated_at
  )
  VALUES (
    p_job_name,
    COALESCE(NULLIF(p_scheduler_type, ''), 'vercel_cron'),
    p_route_path,
    p_started_at,
    p_finished_at,
    p_status,
    p_duration_ms,
    p_rows_affected,
    p_error_code,
    p_error_message,
    CASE WHEN p_status = 'RUNNING' THEN 0 ELSE 1 END,
    now()
  )
  ON CONFLICT (job_name) DO UPDATE
  SET
    scheduler_type = EXCLUDED.scheduler_type,
    route_path = EXCLUDED.route_path,
    last_started_at = COALESCE(EXCLUDED.last_started_at, public.cron_job_heartbeats.last_started_at),
    last_finished_at = EXCLUDED.last_finished_at,
    last_status = EXCLUDED.last_status,
    last_duration_ms = EXCLUDED.last_duration_ms,
    last_rows_affected = EXCLUDED.last_rows_affected,
    last_error_code = EXCLUDED.last_error_code,
    last_error_message = EXCLUDED.last_error_message,
    run_count = public.cron_job_heartbeats.run_count + CASE WHEN EXCLUDED.last_status = 'RUNNING' THEN 0 ELSE 1 END,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON TABLE public.cron_job_heartbeats FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.cron_job_heartbeats TO service_role;

REVOKE ALL ON FUNCTION public.upsert_cron_job_heartbeat(text, text, text, text, timestamptz, timestamptz, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_cron_job_heartbeat(text, text, text, text, timestamptz, timestamptz, integer, integer, text, text) TO service_role;

ALTER TABLE public.cron_job_heartbeats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cron_job_heartbeats_service_role_only ON public.cron_job_heartbeats;
CREATE POLICY cron_job_heartbeats_service_role_only
ON public.cron_job_heartbeats
FOR ALL
TO public
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

COMMIT;
