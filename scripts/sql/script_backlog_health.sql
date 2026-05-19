-- @pack_id: script_backlog_health
-- @contract_version: v1
-- @db_required: true
-- @red_green_criteria: RED when queue upload backlog ages exceed agreed SLO.
-- Queue-only backlog health (read-only). Google upload authority = offline_conversion_queue.

WITH queue_by_site AS (
  SELECT
    q.site_id,
    COUNT(*) FILTER (WHERE q.status IN ('QUEUED', 'RETRY', 'PROCESSING', 'BLOCKED_PRECEDING_SIGNALS'))::int AS offline_queue_active_count,
    MIN(q.created_at) FILTER (WHERE q.status = 'QUEUED') AS oldest_queued_at,
    MIN(q.created_at) FILTER (WHERE q.status = 'PROCESSING') AS oldest_processing_at,
    COUNT(*) FILTER (WHERE q.status = 'RETRY')::int AS retry_count,
    COUNT(*) FILTER (
      WHERE q.status = 'PROCESSING'
        AND q.provider_request_id IS NOT NULL
        AND NULLIF(BTRIM(q.provider_request_id), '') IS NOT NULL
    )::int AS processing_with_provider_request_id_count
  FROM public.offline_conversion_queue q
  GROUP BY q.site_id
)
SELECT
  s.id AS site_id,
  s.name AS site_name,
  COALESCE(q.offline_queue_active_count, 0) AS offline_queue_active_count,
  q.oldest_queued_at,
  CASE WHEN q.oldest_queued_at IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (now() - q.oldest_queued_at))::bigint
  END AS oldest_queued_age_seconds,
  q.oldest_processing_at,
  CASE WHEN q.oldest_processing_at IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (now() - q.oldest_processing_at))::bigint
  END AS oldest_processing_age_seconds,
  COALESCE(q.processing_with_provider_request_id_count, 0) AS processing_with_provider_request_id_count,
  COALESCE(q.retry_count, 0) AS retry_count
FROM public.sites s
LEFT JOIN queue_by_site q ON q.site_id = s.id
ORDER BY offline_queue_active_count DESC, oldest_queued_age_seconds DESC NULLS LAST, s.name ASC;
