-- @pack_id: scheduler_heartbeat_health
-- @contract_version: v1
-- @db_required: true
-- @red_green_criteria: RED when any critical job heartbeat is stale or in FAIL state.
-- Scheduler heartbeat health (read-only)

WITH critical_jobs AS (
  SELECT unnest(ARRAY[
    'oci-maintenance'::text,
    'cleanup'::text
  ]) AS job_name
),
heartbeats AS (
  SELECT
    h.job_name,
    h.route_path,
    h.last_status,
    h.last_started_at,
    h.last_finished_at,
    h.last_duration_ms,
    h.last_rows_affected,
    h.last_error_code,
    h.run_count,
    EXTRACT(EPOCH FROM (now() - COALESCE(h.last_finished_at, h.last_started_at)))::bigint AS heartbeat_age_seconds
  FROM public.cron_job_heartbeats h
)
SELECT
  c.job_name,
  hb.route_path,
  COALESCE(hb.last_status, 'MISSING') AS last_status,
  hb.last_started_at,
  hb.last_finished_at,
  hb.last_duration_ms,
  hb.last_rows_affected,
  hb.last_error_code,
  hb.run_count,
  hb.heartbeat_age_seconds,
  CASE
    WHEN hb.job_name IS NULL THEN 'RED'
    WHEN COALESCE(hb.last_status, 'UNKNOWN') = 'FAIL' THEN 'RED'
    WHEN hb.heartbeat_age_seconds IS NULL THEN 'RED'
    WHEN hb.heartbeat_age_seconds > 3600 THEN 'RED'
    WHEN COALESCE(hb.last_status, 'UNKNOWN') = 'PARTIAL' THEN 'YELLOW'
    WHEN COALESCE(hb.last_status, 'UNKNOWN') IN ('PASS', 'RUNNING') THEN 'GREEN'
    ELSE 'YELLOW'
  END AS contract_status
FROM critical_jobs c
LEFT JOIN heartbeats hb
  ON hb.job_name = c.job_name
ORDER BY c.job_name;
