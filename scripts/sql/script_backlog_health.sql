-- @pack_id: script_backlog_health
-- @contract_version: v1
-- @db_required: true
-- @red_green_criteria: RED when queue upload backlog ages exceed agreed SLO; parity mismatch (eligible marketing_signals without queue match) is fail-closed signal.
-- Script-mode backlog health (read-only)
-- Focus: queue upload pressure (authority) + parity mismatch + marketing_signals pending (legacy/audit observability).

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
),
parity_mode AS (
  SELECT CASE lower(COALESCE(current_setting('app.settings.oci_marketing_signal_queue_parity_enforcement', true), 'observe'))
    WHEN 'enforce' THEN 'enforce'
    ELSE 'observe'
  END AS parity_enforcement_mode
),
parity_gap_by_site AS (
  SELECT
    ms.site_id,
    COUNT(*)::int AS marketing_signals_queue_parity_gap_count,
    MIN(ms.created_at) AS oldest_parity_gap_at
  FROM public.marketing_signals ms
  WHERE ms.dispatch_status IN ('PENDING', 'RETRY', 'PROCESSING')
    AND COALESCE(NULLIF(trim(ms.gclid), ''), NULLIF(trim(ms.wbraid), ''), NULLIF(trim(ms.gbraid), '')) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.offline_conversion_queue q
      WHERE q.site_id = ms.site_id
        AND q.call_id = ms.call_id
        AND q.provider_key = 'google_ads'
        AND q.action = ms.google_conversion_name
    )
  GROUP BY ms.site_id
)
SELECT
  s.id AS site_id,
  s.name AS site_name,
  pm.parity_enforcement_mode,
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
  COALESCE(pg.marketing_signals_queue_parity_gap_count, 0) AS marketing_signals_queue_parity_gap_count,
  pg.oldest_parity_gap_at,
  CASE WHEN pg.oldest_parity_gap_at IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (now() - pg.oldest_parity_gap_at))::bigint
  END AS oldest_parity_gap_age_seconds,
  sig.oldest_pending_at,
  CASE WHEN sig.oldest_pending_at IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (now() - sig.oldest_pending_at))::bigint
  END AS oldest_pending_age_seconds
FROM public.sites s
CROSS JOIN parity_mode pm
LEFT JOIN queue_by_site q
  ON q.site_id = s.id
LEFT JOIN signals_by_site sig
  ON sig.site_id = s.id
LEFT JOIN parity_gap_by_site pg
  ON pg.site_id = s.id
ORDER BY marketing_signals_queue_parity_gap_count DESC, marketing_signals_pending_count DESC, offline_conversion_queue_active_count DESC, s.name ASC;
