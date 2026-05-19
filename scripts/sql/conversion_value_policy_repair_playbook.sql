-- Conversion value policy repair playbook (dry-run first, idempotent, non-destructive).
-- Policy version: oci_conversion_value_policy_v1
-- Queue journal only.

WITH policy AS (
  SELECT * FROM (
    VALUES
      ('offline_conversion_queue'::text, 'OpsMantik_Won'::text, 6000::bigint, 12000::bigint, NULL::bigint),
      ('offline_conversion_queue'::text, 'OpsMantik_Contacted'::text, 600::bigint, 1200::bigint, NULL::bigint),
      ('offline_conversion_queue'::text, 'OpsMantik_Offered'::text, 3000::bigint, 6000::bigint, NULL::bigint),
      ('offline_conversion_queue'::text, 'OpsMantik_Junk_Exclusion'::text, 10::bigint, 10::bigint, 10::bigint)
  ) AS t(source_table, conversion_name, min_cents, max_cents, fixed_cents)
),
rows_union AS (
  SELECT
    'offline_conversion_queue'::text AS source_table,
    q.id::text AS row_id,
    q.site_id,
    q.action AS conversion_name,
    q.value_cents,
    q.entry_reason,
    q.value_source,
    q.value_policy_version AS policy_version,
    q.created_at,
    q.updated_at,
    q.status AS lifecycle_status
  FROM public.offline_conversion_queue q
  WHERE q.action IN (
    'OpsMantik_Won',
    'OpsMantik_Contacted',
    'OpsMantik_Offered',
    'OpsMantik_Junk_Exclusion'
  )
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
    END AS drift_reason
  FROM rows_union r
  LEFT JOIN policy p
    ON p.source_table = r.source_table
   AND p.conversion_name = r.conversion_name
)
SELECT
  e.source_table,
  e.site_id,
  s.name AS site_name,
  e.row_id,
  e.conversion_name,
  e.value_cents,
  e.min_cents,
  e.max_cents,
  e.fixed_cents,
  e.drift_reason,
  e.entry_reason,
  e.value_source,
  e.policy_version,
  e.created_at,
  e.updated_at,
  e.lifecycle_status
FROM evaluated e
LEFT JOIN public.sites s ON s.id = e.site_id
WHERE e.drift_reason <> 'ok'
ORDER BY e.created_at DESC;

-- Per-site summary for canary selection
WITH drift AS (
  SELECT site_id, drift_reason
  FROM (
    WITH policy AS (
      SELECT * FROM (
        VALUES
          ('offline_conversion_queue'::text, 'OpsMantik_Won'::text, 6000::bigint, 12000::bigint, NULL::bigint),
          ('offline_conversion_queue'::text, 'OpsMantik_Contacted'::text, 600::bigint, 1200::bigint, NULL::bigint),
          ('offline_conversion_queue'::text, 'OpsMantik_Offered'::text, 3000::bigint, 6000::bigint, NULL::bigint),
          ('offline_conversion_queue'::text, 'OpsMantik_Junk_Exclusion'::text, 10::bigint, 10::bigint, 10::bigint)
      ) AS t(source_table, conversion_name, min_cents, max_cents, fixed_cents)
    ),
    rows_union AS (
      SELECT
        q.site_id,
        q.action AS conversion_name,
        q.value_cents,
        q.value_policy_version AS policy_version,
        q.value_source
      FROM public.offline_conversion_queue q
      WHERE q.action IN (
        'OpsMantik_Won',
        'OpsMantik_Contacted',
        'OpsMantik_Offered',
        'OpsMantik_Junk_Exclusion'
      )
    )
    SELECT
      r.site_id,
      CASE
        WHEN p.conversion_name IS NULL THEN 'missing_policy_row'
        WHEN r.value_cents IS NULL OR r.value_cents <= 0 THEN 'invalid_non_positive'
        WHEN p.fixed_cents IS NOT NULL AND r.value_cents <> p.fixed_cents THEN 'fixed_value_mismatch'
        WHEN p.fixed_cents IS NULL AND (r.value_cents < p.min_cents OR r.value_cents > p.max_cents) THEN 'range_mismatch'
        WHEN COALESCE(r.policy_version, '') = '' THEN 'missing_policy_version'
        WHEN COALESCE(r.value_source, '') = '' THEN 'missing_value_source'
        ELSE 'ok'
      END AS drift_reason
    FROM rows_union r
    LEFT JOIN policy p ON p.conversion_name = r.conversion_name
  ) x
  WHERE drift_reason <> 'ok'
)
SELECT
  d.site_id,
  s.name AS site_name,
  d.drift_reason,
  COUNT(*)::int AS rows_count
FROM drift d
LEFT JOIN public.sites s ON s.id = d.site_id
GROUP BY d.site_id, s.name, d.drift_reason
ORDER BY rows_count DESC, d.site_id;

-- Repair: re-enqueue through app SSOT (`ensureOciQueueEnqueue` / stage router) per call; never bulk blind overwrite.
