-- @pack_id: oci_time_ssot_health
-- @contract_version: v1
-- @db_required: true
-- @red_green_criteria: RED when any call-bound row has conversion timestamps drifted from occurred_at.
-- OCI time SSOT health (read-only, queue journal only).

WITH offline_queue_drift AS (
  SELECT COUNT(*)::int AS drifted_rows
  FROM public.offline_conversion_queue q
  WHERE q.call_id IS NOT NULL
    AND (
      q.occurred_at IS NULL
      OR q.conversion_time IS NULL
      OR q.source_timestamp IS NULL
      OR q.conversion_time IS DISTINCT FROM q.occurred_at
      OR q.source_timestamp IS DISTINCT FROM q.occurred_at
    )
)
SELECT
  'offline_conversion_queue'::text AS surface,
  oq.drifted_rows,
  CASE WHEN oq.drifted_rows = 0 THEN 'GREEN' ELSE 'RED' END AS contract_status
FROM offline_queue_drift oq;
