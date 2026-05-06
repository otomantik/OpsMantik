-- Script-mode backlog health (read-only)
-- Focus: active queue pressure + marketing_signals pending pressure by site.

WITH queue_by_site AS (
  SELECT
    q.site_id,
    COUNT(*) FILTER (WHERE q.status IN ('QUEUED', 'RETRY', 'PROCESSING', 'BLOCKED_PRECEDING_SIGNALS'))::int AS offline_queue_active_count,
    MIN(q.created_at) FILTER (WHERE q.status = 'QUEUED') AS oldest_queued_at,
    MIN(q.created_at) FILTER (WHERE q.status = 'PROCESSING') AS oldest_processing_at,
    COUNT(*) FILTER (WHERE q.status = 'RETRY')::int AS retry_count
  FROM public.offline_conversion_queue q
  GROUP BY q.site_id
),
signals_by_site AS (
  SELECT
    ms.site_id,
    COUNT(*) FILTER (WHERE ms.dispatch_status = 'PENDING')::int AS marketing_signals_pending_count,
    MIN(ms.created_at) FILTER (WHERE ms.dispatch_status = 'PENDING') AS oldest_pending_at
  FROM public.marketing_signals ms
  GROUP BY ms.site_id
)
SELECT
  s.id AS site_id,
  s.name AS site_name,
  COALESCE(q.offline_queue_active_count, 0) AS offline_conversion_queue_active_count,
  q.oldest_queued_at,
  CASE WHEN q.oldest_queued_at IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (now() - q.oldest_queued_at))::bigint
  END AS oldest_queued_age_seconds,
  q.oldest_processing_at,
  CASE WHEN q.oldest_processing_at IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (now() - q.oldest_processing_at))::bigint
  END AS oldest_processing_age_seconds,
  COALESCE(q.retry_count, 0) AS retry_count,
  COALESCE(sig.marketing_signals_pending_count, 0) AS marketing_signals_pending_count,
  sig.oldest_pending_at,
  CASE WHEN sig.oldest_pending_at IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (now() - sig.oldest_pending_at))::bigint
  END AS oldest_pending_age_seconds
FROM public.sites s
LEFT JOIN queue_by_site q
  ON q.site_id = s.id
LEFT JOIN signals_by_site sig
  ON sig.site_id = s.id
ORDER BY marketing_signals_pending_count DESC, offline_conversion_queue_active_count DESC, s.name ASC;
