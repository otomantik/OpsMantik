-- Value integrity health (read-only)
-- PR-D policy: oci_conversion_value_policy_v1
--
-- GREEN: drifted_rows = 0 for active sites
-- RED: any non-waived drifted_rows > 0

WITH policy AS (
  SELECT * FROM (
    VALUES
      ('offline_conversion_queue'::text, 'OpsMantik_Won'::text, 6000::bigint, 12000::bigint, NULL::bigint),
      ('marketing_signals'::text, 'OpsMantik_Contacted'::text, 600::bigint, 1200::bigint, NULL::bigint),
      ('marketing_signals'::text, 'OpsMantik_Offered'::text, 3000::bigint, 6000::bigint, NULL::bigint),
      ('marketing_signals'::text, 'OpsMantik_Junk_Exclusion'::text, 10::bigint, 10::bigint, 10::bigint),
      ('marketing_signals'::text, 'OpsMantik_Won'::text, 6000::bigint, 12000::bigint, NULL::bigint)
  ) AS t(source_table, conversion_name, min_cents, max_cents, fixed_cents)
),
queue_rows AS (
  SELECT
    'offline_conversion_queue'::text AS source_table,
    q.site_id,
    q.id::text AS row_id,
    q.action AS conversion_name,
    q.value_cents AS value_cents,
    q.entry_reason,
    q.value_source,
    q.value_policy_version AS policy_version,
    q.created_at,
    q.updated_at,
    q.status AS lifecycle_status
  FROM public.offline_conversion_queue q
  WHERE q.action = 'OpsMantik_Won'
),
signal_rows AS (
  SELECT
    'marketing_signals'::text AS source_table,
    ms.site_id,
    ms.id::text AS row_id,
    ms.google_conversion_name AS conversion_name,
    ms.expected_value_cents AS value_cents,
    ms.entry_reason,
    ms.value_source,
    ms.value_policy_version AS policy_version,
    ms.created_at,
    ms.updated_at,
    ms.dispatch_status AS lifecycle_status
  FROM public.marketing_signals ms
  WHERE ms.google_conversion_name IN (
    'OpsMantik_Contacted',
    'OpsMantik_Offered',
    'OpsMantik_Junk_Exclusion',
    'OpsMantik_Won'
  )
),
rows_union AS (
  SELECT * FROM queue_rows
  UNION ALL
  SELECT * FROM signal_rows
),
evaluated AS (
  SELECT
    r.*,
    p.min_cents,
    p.max_cents,
    p.fixed_cents,
    CASE
      WHEN p.conversion_name IS NULL THEN 'missing_policy_row'
      WHEN r.value_cents IS NULL OR r.value_cents <= 0 THEN 'invalid_non_positive'
      WHEN p.fixed_cents IS NOT NULL AND r.value_cents <> p.fixed_cents THEN 'fixed_value_mismatch'
      WHEN p.fixed_cents IS NULL AND (r.value_cents < p.min_cents OR r.value_cents > p.max_cents) THEN 'range_mismatch'
      WHEN COALESCE(r.policy_version, '') = '' THEN 'missing_policy_version'
      WHEN COALESCE(r.value_source, '') = '' THEN 'missing_value_source'
      ELSE 'ok'
    END AS contract_status
  FROM rows_union r
  LEFT JOIN policy p
    ON p.source_table = r.source_table
   AND p.conversion_name = r.conversion_name
),
agg AS (
  SELECT
    e.source_table,
    e.site_id,
    e.conversion_name,
    COALESCE(NULLIF(MAX(e.policy_version), ''), 'missing') AS policy_version,
    COUNT(*)::int AS total_rows,
    COUNT(*) FILTER (WHERE e.contract_status <> 'ok')::int AS drifted_rows,
    ROUND(
      (COUNT(*) FILTER (WHERE e.contract_status <> 'ok'))::numeric / NULLIF(COUNT(*), 0)::numeric,
      4
    ) AS drift_ratio,
    MIN(e.created_at) FILTER (WHERE e.contract_status <> 'ok') AS oldest_drift_at
  FROM evaluated e
  GROUP BY e.source_table, e.site_id, e.conversion_name
)
SELECT
  a.policy_version,
  CASE WHEN a.drifted_rows = 0 THEN 'GREEN' ELSE 'RED' END AS contract_status,
  a.source_table,
  a.site_id,
  s.name AS site_name,
  a.conversion_name,
  a.total_rows,
  a.drifted_rows,
  COALESCE(a.drift_ratio, 0) AS drift_ratio,
  a.oldest_drift_at,
  CASE
    WHEN a.oldest_drift_at IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (now() - a.oldest_drift_at))::bigint
  END AS oldest_drift_age_seconds
FROM agg a
LEFT JOIN public.sites s
  ON s.id = a.site_id
ORDER BY a.drifted_rows DESC, a.conversion_name, a.site_id;

-- Sample offending rows (actionable triage)
SELECT
  e.source_table,
  e.site_id,
  s.name AS site_name,
  e.conversion_name,
  e.row_id,
  e.value_cents,
  e.contract_status,
  e.entry_reason,
  e.value_source,
  e.policy_version,
  e.created_at,
  e.updated_at,
  e.lifecycle_status
FROM evaluated e
LEFT JOIN public.sites s
  ON s.id = e.site_id
WHERE e.contract_status <> 'ok'
ORDER BY e.created_at DESC
LIMIT 200;
