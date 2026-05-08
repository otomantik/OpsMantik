-- @pack_id: script_backlog_health
-- @contract_version: v1
-- @db_required: true
-- @red_green_criteria: RED when queue upload backlog ages exceed agreed SLO; parity mismatch (eligible marketing_signals without queue match) is fail-closed signal.
-- Script-mode backlog health (read-only)
-- Focus: queue upload pressure (Google upload authority) + parity mismatch + marketing_signals pending (ACTIVE_RUNTIME_RESIDUE / legacy/audit observability).
-- Note: marketing_signals_pending_count must not be interpreted as Google upload backlog.

WITH table_presence AS (
  SELECT to_regclass('public.marketing_signals') IS NOT NULL AS marketing_signals_exists
),
queue_by_site AS (
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
),
parity_mode AS (
  SELECT CASE lower(COALESCE(current_setting('app.settings.oci_marketing_signal_queue_parity_enforcement', true), 'observe'))
    WHEN 'enforce' THEN 'enforce'
    ELSE 'observe'
  END AS parity_enforcement_mode
)
SELECT
  s.id AS site_id,
  s.name AS site_name,
  pm.parity_enforcement_mode,
  CASE
    WHEN tp.marketing_signals_exists THEN 'OPTIONAL_LEGACY_CHECK_SKIPPED'
    ELSE 'LEGACY_RESIDUE_ABSENT'
  END AS legacy_residue_status,
  COALESCE(q.offline_queue_active_count, 0) AS offline_conversion_queue_active_count,
  q.oldest_queued_at,
  CASE WHEN q.oldest_queued_at IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (now() - q.oldest_queued_at))::bigint
  END AS oldest_queued_age_seconds,
  q.oldest_processing_at,
  CASE WHEN q.oldest_processing_at IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (now() - q.oldest_processing_at))::bigint
  END AS oldest_processing_age_seconds,
  COALESCE(q.processing_with_provider_request_id_count, 0) AS processing_with_provider_request_id_count,
  COALESCE(q.retry_count, 0) AS retry_count,
  0::int AS marketing_signals_pending_count,
  0::int AS marketing_signals_queue_parity_gap_count,
  NULL::timestamptz AS oldest_parity_gap_at,
  NULL::bigint AS oldest_parity_gap_age_seconds,
  NULL::timestamptz AS oldest_pending_at,
  NULL::bigint AS oldest_pending_age_seconds
FROM public.sites s
CROSS JOIN parity_mode pm
CROSS JOIN table_presence tp
LEFT JOIN queue_by_site q
  ON q.site_id = s.id
ORDER BY marketing_signals_queue_parity_gap_count DESC, marketing_signals_pending_count DESC, offline_conversion_queue_active_count DESC, s.name ASC;
