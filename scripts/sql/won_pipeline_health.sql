-- Won/Sealed pipeline health (read-only)
-- Shows whether sale-terminal calls are represented in queue/sent pipeline.

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
active_queue AS (
  SELECT DISTINCT q.site_id, q.call_id
  FROM public.offline_conversion_queue q
  WHERE q.status IN ('QUEUED', 'RETRY', 'PROCESSING', 'BLOCKED_PRECEDING_SIGNALS')
),
completed_queue AS (
  SELECT DISTINCT q.site_id, q.call_id
  FROM public.offline_conversion_queue q
  WHERE q.status IN ('COMPLETED', 'UPLOADED', 'COMPLETED_UNVERIFIED')
),
missing AS (
  SELECT w.*
  FROM won_or_sealed w
  LEFT JOIN active_queue aq
    ON aq.site_id = w.site_id
   AND aq.call_id = w.call_id
  LEFT JOIN completed_queue cq
    ON cq.site_id = w.site_id
   AND cq.call_id = w.call_id
  WHERE aq.call_id IS NULL
    AND cq.call_id IS NULL
)
SELECT
  s.id AS site_id,
  s.name AS site_name,
  COALESCE((SELECT COUNT(*) FROM won_only w WHERE w.site_id = s.id), 0)::int AS won_total,
  COALESCE((SELECT COUNT(*) FROM won_or_sealed ws WHERE ws.site_id = s.id), 0)::int AS won_or_sealed_total,
  COALESCE((SELECT COUNT(*) FROM won_or_sealed ws JOIN active_queue aq ON aq.site_id = ws.site_id AND aq.call_id = ws.call_id WHERE ws.site_id = s.id), 0)::int AS won_in_active_queue,
  COALESCE((SELECT COUNT(*) FROM won_or_sealed ws JOIN completed_queue cq ON cq.site_id = ws.site_id AND cq.call_id = ws.call_id WHERE ws.site_id = s.id), 0)::int AS won_completed_or_uploaded,
  COALESCE((SELECT COUNT(*) FROM missing m WHERE m.site_id = s.id), 0)::int AS won_missing_pipeline,
  (
    SELECT EXTRACT(EPOCH FROM (now() - MIN(m.confirmed_at)))
    FROM missing m
    WHERE m.site_id = s.id
  )::bigint AS oldest_missing_won_age_seconds,
  COALESCE(
    ROUND(
      (
        (SELECT COUNT(*) FROM missing m WHERE m.site_id = s.id)::numeric
        / NULLIF((SELECT COUNT(*) FROM won_or_sealed ws WHERE ws.site_id = s.id), 0)::numeric
      ),
      4
    ),
    0
  ) AS leak_rate
FROM public.sites s
ORDER BY won_missing_pipeline DESC, won_or_sealed_total DESC, s.name ASC;
