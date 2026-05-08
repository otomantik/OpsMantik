-- @pack_id: won_pipeline_health
-- @contract_version: v2
-- @db_required: true
-- @red_green_criteria: RED when won_missing_unrepresented_count > 0.
-- Won/Sealed pipeline health (read-only)
-- Upload truth for Google batch is offline_conversion_queue. This pack checks won/sealed representation there.

WITH won_or_sealed AS (
  SELECT
    c.site_id,
    c.id AS call_id,
    c.confirmed_at,
    c.status,
    c.oci_status
  FROM public.calls c
  WHERE c.confirmed_at IS NOT NULL
    AND (c.status = 'won' OR c.oci_status = 'sealed')
),
won_only AS (
  SELECT * FROM won_or_sealed WHERE status = 'won'
),
won_queue_rows AS (
  SELECT DISTINCT q.site_id, q.call_id, q.status
  FROM public.offline_conversion_queue q
  WHERE q.action = 'OpsMantik_Won'
    AND q.call_id IS NOT NULL
),
represented_active AS (
  SELECT DISTINCT q.site_id, q.call_id
  FROM won_queue_rows q
  WHERE q.status IN ('QUEUED', 'RETRY', 'PROCESSING', 'BLOCKED_PRECEDING_SIGNALS')
),
represented_completed AS (
  SELECT DISTINCT q.site_id, q.call_id
  FROM won_queue_rows q
  WHERE q.status IN ('COMPLETED', 'UPLOADED', 'COMPLETED_UNVERIFIED')
),
represented_failed_terminal AS (
  SELECT DISTINCT q.site_id, q.call_id
  FROM won_queue_rows q
  WHERE q.status IN ('FAILED', 'DEAD_LETTER_QUARANTINE', 'VOIDED_BY_REVERSAL')
),
represented_any AS (
  SELECT DISTINCT q.site_id, q.call_id
  FROM won_queue_rows q
),
missing_unrepresented AS (
  SELECT w.*
  FROM won_or_sealed w
  LEFT JOIN represented_any rq
    ON rq.site_id = w.site_id
   AND rq.call_id = w.call_id
  WHERE rq.call_id IS NULL
)
SELECT
  s.id AS site_id,
  s.name AS site_name,
  COALESCE((SELECT COUNT(*) FROM won_only w WHERE w.site_id = s.id), 0)::int AS won_total,
  COALESCE((SELECT COUNT(*) FROM won_or_sealed ws WHERE ws.site_id = s.id), 0)::int AS won_or_sealed_total,
  COALESCE((SELECT COUNT(*) FROM won_or_sealed ws JOIN represented_active ra ON ra.site_id = ws.site_id AND ra.call_id = ws.call_id WHERE ws.site_id = s.id), 0)::int AS won_represented_active_count,
  COALESCE((SELECT COUNT(*) FROM won_or_sealed ws JOIN represented_completed rc ON rc.site_id = ws.site_id AND rc.call_id = ws.call_id WHERE ws.site_id = s.id), 0)::int AS won_represented_completed_count,
  COALESCE((SELECT COUNT(*) FROM won_or_sealed ws JOIN represented_failed_terminal rf ON rf.site_id = ws.site_id AND rf.call_id = ws.call_id WHERE ws.site_id = s.id), 0)::int AS won_represented_failed_terminal_count,
  COALESCE((SELECT COUNT(*) FROM won_or_sealed ws JOIN represented_any ra ON ra.site_id = ws.site_id AND ra.call_id = ws.call_id WHERE ws.site_id = s.id), 0)::int AS won_pipeline_represented_total,
  COALESCE((SELECT COUNT(*) FROM missing_unrepresented m WHERE m.site_id = s.id), 0)::int AS won_missing_unrepresented_count,
  COALESCE((SELECT COUNT(*) FROM missing_unrepresented m WHERE m.site_id = s.id), 0)::int AS won_missing_pipeline_count,
  -- Backward-compatible alias kept for existing consumers.
  COALESCE((SELECT COUNT(*) FROM missing_unrepresented m WHERE m.site_id = s.id), 0)::int AS won_missing_pipeline,
  COALESCE((SELECT COUNT(*) FROM won_or_sealed ws JOIN represented_active ra ON ra.site_id = ws.site_id AND ra.call_id = ws.call_id WHERE ws.site_id = s.id), 0)::int AS won_in_queue,
  COALESCE((SELECT COUNT(*) FROM won_or_sealed ws JOIN represented_active ra ON ra.site_id = ws.site_id AND ra.call_id = ws.call_id WHERE ws.site_id = s.id), 0)::int AS won_in_active_queue,
  COALESCE((SELECT COUNT(*) FROM won_or_sealed ws JOIN represented_completed rc ON rc.site_id = ws.site_id AND rc.call_id = ws.call_id WHERE ws.site_id = s.id), 0)::int AS won_completed,
  COALESCE((SELECT COUNT(*) FROM won_or_sealed ws JOIN represented_completed rc ON rc.site_id = ws.site_id AND rc.call_id = ws.call_id WHERE ws.site_id = s.id), 0)::int AS won_completed_or_uploaded,
  (
    SELECT EXTRACT(EPOCH FROM (now() - MIN(m.confirmed_at)))
    FROM missing_unrepresented m
    WHERE m.site_id = s.id
  )::bigint AS oldest_missing_won_age_seconds,
  (
    SELECT MIN(m.confirmed_at)
    FROM missing_unrepresented m
    WHERE m.site_id = s.id
  ) AS oldest_missing_confirmed_at,
  COALESCE(
    ROUND(
      (
        (SELECT COUNT(*) FROM missing_unrepresented m WHERE m.site_id = s.id)::numeric
        / NULLIF((SELECT COUNT(*) FROM won_or_sealed ws WHERE ws.site_id = s.id), 0)::numeric
      ),
      4
    ),
    0
  ) AS leak_rate
FROM public.sites s
ORDER BY won_missing_unrepresented_count DESC, won_or_sealed_total DESC, s.name ASC;
