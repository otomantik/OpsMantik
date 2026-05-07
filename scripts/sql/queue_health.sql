-- @pack_id: queue_health
-- @contract_version: v1
-- @policy_version: queue_health_contract_v1
-- @db_required: true
-- @red_green_criteria: RED when stuck>0 OR won_missing_pipeline>0 OR dlq>0 OR retry_rate>0.3 OR actionable_failed_rate>0.2 OR provider_failed_rate>0.2 OR unknown_failed_count>0 OR queued/retry age > 7d. Deterministic skips visible but excluded from actionable/provider rate numerators (PR-1C).
-- Composed operational queue health per site (read-only). SSOT time/value packs are separate; merge in evidence.
-- Stuck window = STUCK_PROCESSING_MAX_AGE_MINUTES (15) aligned with lib/oci/queue-health-contract.ts

WITH
params AS (
  SELECT
    15::int AS stuck_age_minutes,
    0.3::numeric AS max_retry_rate,
    0.2::numeric AS max_failed_rate,
    (7 * 24 * 60)::int AS max_age_minutes
),
queue_counts AS (
  SELECT
    q.site_id,
    COUNT(*)::int AS total_rows,
    COUNT(*) FILTER (WHERE q.status = 'QUEUED')::int AS queued_count,
    COUNT(*) FILTER (WHERE q.status = 'RETRY')::int AS retry_count,
    COUNT(*) FILTER (WHERE q.status = 'PROCESSING')::int AS processing_count,
    COUNT(*) FILTER (WHERE q.status = 'FAILED')::int AS failed_count,
    COUNT(*) FILTER (WHERE q.status = 'DEAD_LETTER_QUARANTINE')::int AS dlq_count
  FROM public.offline_conversion_queue q
  GROUP BY q.site_id
),
failed_taxonomy AS (
  SELECT
    q.site_id,
    COUNT(*) FILTER (WHERE q.status = 'FAILED')::int AS total_failed_count,
    COUNT(*) FILTER (
      WHERE q.status = 'FAILED' AND q.provider_error_category = 'DETERMINISTIC_SKIP'
    )::int AS deterministic_skip_count,
    COUNT(*) FILTER (
      WHERE q.status = 'FAILED' AND q.provider_error_code = 'SUPPRESSED_BY_HIGHER_GEAR'
    )::int AS suppressed_higher_gear_count,
    COUNT(*) FILTER (
      WHERE q.status = 'FAILED'
        AND q.provider_error_category IN ('TRANSIENT', 'RATE_LIMIT', 'AUTH')
    )::int AS provider_failed_count,
    COUNT(*) FILTER (
      WHERE q.status = 'FAILED'
        AND q.provider_error_category IN ('VALIDATION', 'PERMANENT')
    )::int AS policy_failed_count,
    COUNT(*) FILTER (
      WHERE q.status = 'FAILED'
        AND (
          q.provider_error_category IS NULL
          OR TRIM(q.provider_error_category) = ''
          OR q.provider_error_category NOT IN (
            'VALIDATION',
            'TRANSIENT',
            'RATE_LIMIT',
            'PERMANENT',
            'DETERMINISTIC_SKIP',
            'AUTH'
          )
        )
    )::int AS unknown_failed_count
  FROM public.offline_conversion_queue q
  GROUP BY q.site_id
),
stuck AS (
  SELECT
    q.site_id,
    COUNT(*)::int AS stuck_processing_count
  FROM public.offline_conversion_queue q
  CROSS JOIN params p
  WHERE q.status = 'PROCESSING'
    AND q.updated_at < (now() - (p.stuck_age_minutes * interval '1 minute'))
  GROUP BY q.site_id
),
won_or_sealed AS (
  SELECT c.site_id, c.id AS call_id, c.confirmed_at, c.status, c.oci_status
  FROM public.calls c
  WHERE c.confirmed_at IS NOT NULL
    AND (c.status = 'won' OR c.oci_status = 'sealed')
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
missing_won AS (
  SELECT w.site_id, COUNT(*)::int AS won_missing_pipeline
  FROM won_or_sealed w
  LEFT JOIN active_queue aq ON aq.site_id = w.site_id AND aq.call_id = w.call_id
  LEFT JOIN completed_queue cq ON cq.site_id = w.site_id AND cq.call_id = w.call_id
  WHERE aq.call_id IS NULL AND cq.call_id IS NULL
  GROUP BY w.site_id
),
ages AS (
  SELECT
    q.site_id,
    CASE WHEN MIN(q.created_at) FILTER (WHERE q.status = 'QUEUED') IS NULL THEN NULL
      ELSE EXTRACT(EPOCH FROM (now() - MIN(q.created_at) FILTER (WHERE q.status = 'QUEUED')))::numeric / 60
    END AS oldest_queued_age_minutes,
    CASE WHEN MIN(q.created_at) FILTER (WHERE q.status = 'RETRY') IS NULL THEN NULL
      ELSE EXTRACT(EPOCH FROM (now() - MIN(q.created_at) FILTER (WHERE q.status = 'RETRY')))::numeric / 60
    END AS oldest_retry_age_minutes,
    CASE WHEN MIN(q.updated_at) FILTER (WHERE q.status = 'PROCESSING') IS NULL THEN NULL
      ELSE EXTRACT(EPOCH FROM (now() - MIN(q.updated_at) FILTER (WHERE q.status = 'PROCESSING')))::numeric / 60
    END AS oldest_processing_age_minutes
  FROM public.offline_conversion_queue q
  GROUP BY q.site_id
),
calc AS (
  SELECT
    s.id AS site_id,
    s.name AS site_name,
    'queue_health_contract_v1'::text AS policy_version,
    COALESCE(qc.total_rows, 0) AS total_queue,
    COALESCE(qc.queued_count, 0) AS queued_count,
    COALESCE(qc.retry_count, 0) AS retry_count,
    COALESCE(qc.processing_count, 0) AS processing_count,
    COALESCE(qc.failed_count, 0) AS failed_count,
    COALESCE(qc.dlq_count, 0) AS dlq_count,
    COALESCE(ft.total_failed_count, 0) AS total_failed_count,
    COALESCE(ft.deterministic_skip_count, 0) AS deterministic_skip_count,
    COALESCE(ft.suppressed_higher_gear_count, 0) AS suppressed_higher_gear_count,
    COALESCE(ft.provider_failed_count, 0) AS provider_failed_count,
    COALESCE(ft.policy_failed_count, 0) AS policy_failed_count,
    COALESCE(ft.unknown_failed_count, 0) AS unknown_failed_count,
    (
      COALESCE(ft.total_failed_count, 0) - COALESCE(ft.deterministic_skip_count, 0)
    )::int AS actionable_failed_count,
    COALESCE(st.stuck_processing_count, 0) AS stuck_processing_count,
    COALESCE(mw.won_missing_pipeline, 0) AS won_missing_pipeline,
    a.oldest_queued_age_minutes,
    a.oldest_retry_age_minutes,
    a.oldest_processing_age_minutes,
    CASE WHEN COALESCE(qc.total_rows, 0) > 0 THEN ROUND((COALESCE(qc.retry_count, 0)::numeric / qc.total_rows), 6) ELSE 0::numeric END AS retry_rate,
    CASE WHEN COALESCE(qc.total_rows, 0) > 0 THEN ROUND(
      ((COALESCE(qc.failed_count, 0) + COALESCE(qc.dlq_count, 0))::numeric / qc.total_rows), 6
    ) ELSE 0::numeric END AS total_failed_rate,
    CASE WHEN COALESCE(qc.total_rows, 0) > 0 THEN ROUND(
      ((
        COALESCE(ft.total_failed_count, 0) - COALESCE(ft.deterministic_skip_count, 0)
        + COALESCE(qc.dlq_count, 0)
      )::numeric / qc.total_rows), 6
    ) ELSE 0::numeric END AS actionable_failed_rate,
    CASE WHEN COALESCE(qc.total_rows, 0) > 0 THEN ROUND(
      (COALESCE(ft.provider_failed_count, 0)::numeric / qc.total_rows), 6
    ) ELSE 0::numeric END AS provider_failed_rate,
    CASE WHEN COALESCE(qc.total_rows, 0) > 0 THEN ROUND(
      (COALESCE(ft.deterministic_skip_count, 0)::numeric / qc.total_rows), 6
    ) ELSE 0::numeric END AS deterministic_skip_rate
  FROM public.sites s
  LEFT JOIN queue_counts qc ON qc.site_id = s.id
  LEFT JOIN failed_taxonomy ft ON ft.site_id = s.id
  LEFT JOIN stuck st ON st.site_id = s.id
  LEFT JOIN missing_won mw ON mw.site_id = s.id
  LEFT JOIN ages a ON a.site_id = s.id
)
SELECT
  c.policy_version,
  c.site_id,
  c.site_name,
  c.total_queue,
  c.queued_count,
  c.retry_count,
  c.processing_count,
  c.failed_count,
  c.dlq_count,
  c.total_failed_count,
  c.deterministic_skip_count,
  c.suppressed_higher_gear_count,
  c.provider_failed_count,
  c.policy_failed_count,
  c.unknown_failed_count,
  c.actionable_failed_count,
  c.dlq_count AS dead_letter_count,
  c.stuck_processing_count,
  c.won_missing_pipeline,
  c.oldest_queued_age_minutes,
  c.oldest_retry_age_minutes,
  c.oldest_processing_age_minutes,
  c.retry_rate,
  c.total_failed_rate,
  c.actionable_failed_rate,
  c.provider_failed_rate,
  c.deterministic_skip_rate,
  c.total_failed_rate AS failed_rate,
  CASE
    WHEN c.stuck_processing_count > 0
      OR c.won_missing_pipeline > 0
      OR c.dlq_count > 0
      OR c.retry_rate > (SELECT max_retry_rate FROM params)
      OR c.actionable_failed_rate > (SELECT max_failed_rate FROM params)
      OR c.provider_failed_rate > (SELECT max_failed_rate FROM params)
      OR c.unknown_failed_count > 0
      OR (c.oldest_queued_age_minutes IS NOT NULL AND c.oldest_queued_age_minutes > (SELECT max_age_minutes FROM params))
      OR (c.oldest_retry_age_minutes IS NOT NULL AND c.oldest_retry_age_minutes > (SELECT max_age_minutes FROM params))
      OR (c.oldest_processing_age_minutes IS NOT NULL AND c.oldest_processing_age_minutes > (SELECT stuck_age_minutes FROM params)::numeric)
    THEN 'RED'
    ELSE 'GREEN'
  END AS contract_status,
  CASE
    WHEN c.stuck_processing_count > 0
      OR c.won_missing_pipeline > 0
      OR c.dlq_count > 0
      OR c.retry_rate > (SELECT max_retry_rate FROM params)
      OR c.actionable_failed_rate > (SELECT max_failed_rate FROM params)
      OR c.provider_failed_rate > (SELECT max_failed_rate FROM params)
      OR c.unknown_failed_count > 0
      OR (c.oldest_queued_age_minutes IS NOT NULL AND c.oldest_queued_age_minutes > (SELECT max_age_minutes FROM params))
      OR (c.oldest_retry_age_minutes IS NOT NULL AND c.oldest_retry_age_minutes > (SELECT max_age_minutes FROM params))
      OR (c.oldest_processing_age_minutes IS NOT NULL AND c.oldest_processing_age_minutes > (SELECT stuck_age_minutes FROM params)::numeric)
    THEN 'RED'
    ELSE 'GREEN'
  END AS queue_health_status,
  TRIM(BOTH ', ' FROM
    COALESCE(NULLIF(CASE WHEN c.stuck_processing_count > 0 THEN 'STUCK_PROCESSING,' ELSE '' END, ''), '')
    || COALESCE(NULLIF(CASE WHEN c.won_missing_pipeline > 0 THEN 'WON_MISSING_PIPELINE,' ELSE '' END, ''), '')
    || COALESCE(NULLIF(CASE WHEN c.dlq_count > 0 THEN 'DLQ_UNREVIEWED,' ELSE '' END, ''), '')
    || COALESCE(NULLIF(CASE WHEN c.retry_rate > (SELECT max_retry_rate FROM params) THEN 'RETRY_RATE_HIGH,' ELSE '' END, ''), '')
    || COALESCE(NULLIF(CASE WHEN c.actionable_failed_rate > (SELECT max_failed_rate FROM params) THEN 'FAILED_RATE_HIGH,' ELSE '' END, ''), '')
    || COALESCE(NULLIF(CASE WHEN c.provider_failed_rate > (SELECT max_failed_rate FROM params) THEN 'PROVIDER_FAILED_RATE_HIGH,' ELSE '' END, ''), '')
    || COALESCE(NULLIF(CASE WHEN c.unknown_failed_count > 0 THEN 'UNKNOWN_FAILED_QUEUE,' ELSE '' END, ''), '')
    || COALESCE(NULLIF(CASE WHEN c.oldest_queued_age_minutes IS NOT NULL AND c.oldest_queued_age_minutes > (SELECT max_age_minutes FROM params) THEN 'QUEUED_TOO_OLD,' ELSE '' END, ''), '')
    || COALESCE(NULLIF(CASE WHEN c.oldest_retry_age_minutes IS NOT NULL AND c.oldest_retry_age_minutes > (SELECT max_age_minutes FROM params) THEN 'RETRY_TOO_OLD,' ELSE '' END, ''), '')
    || COALESCE(NULLIF(CASE WHEN c.oldest_processing_age_minutes IS NOT NULL AND c.oldest_processing_age_minutes > (SELECT stuck_age_minutes FROM params)::numeric THEN 'PROCESSING_BACKLOG_STALE,' ELSE '' END, ''), '')
  ) AS blocking_reasons
FROM calc c
ORDER BY c.site_name ASC;
