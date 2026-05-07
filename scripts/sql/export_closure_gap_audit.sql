-- @pack_id: export_closure_gap_audit
-- @contract_version: v1
-- @db_required: true
-- @red_green_criteria: RED when stale_active_journal_rows > 0 beyond policy window OR registry shows malformed external_id shape (investigate per site).
-- Export closure gap signals (read-only): long-lived active journal rows + external_id registry sample.
-- Does not prove full “expected 4-tuple per lead” without business policy tables — use as SRE smoke + input to reconciliation.

WITH
params AS (
  SELECT (48 * 60)::int AS stale_active_max_age_minutes
),
stale AS (
  SELECT
    q.site_id,
    COUNT(*) FILTER (
      WHERE q.status = ANY (ARRAY['QUEUED'::text, 'RETRY'::text, 'PROCESSING'::text, 'UPLOADED'::text])
        AND q.updated_at < (now() - ((SELECT stale_active_max_age_minutes FROM params) || ' minutes')::interval)
    )::bigint AS stale_active_journal_rows
  FROM public.offline_conversion_queue q
  WHERE q.provider_key = 'google_ads'
  GROUP BY q.site_id
),
shape AS (
  SELECT
    q.site_id,
    COUNT(*) FILTER (
      WHERE q.external_id IS NOT NULL
        AND q.external_id !~ '^oci_[0-9a-f]{32}$'
    )::bigint AS malformed_external_id_rows
  FROM public.offline_conversion_queue q
  WHERE q.provider_key = 'google_ads'
  GROUP BY q.site_id
)
SELECT
  COALESCE(s.site_id, sh.site_id) AS site_id,
  COALESCE(s.stale_active_journal_rows, 0::bigint) AS stale_active_journal_rows,
  COALESCE(sh.malformed_external_id_rows, 0::bigint) AS malformed_external_id_rows,
  CASE
    WHEN COALESCE(s.stale_active_journal_rows, 0) > 0 OR COALESCE(sh.malformed_external_id_rows, 0) > 0 THEN 'RED'::text
    ELSE 'GREEN'::text
  END AS contract_status,
  CASE
    WHEN COALESCE(s.stale_active_journal_rows, 0) > 0 THEN ARRAY['STALE_ACTIVE_JOURNAL']::text[]
    WHEN COALESCE(sh.malformed_external_id_rows, 0) > 0 THEN ARRAY['EXTERNAL_ID_SHAPE_DRIFT']::text[]
    ELSE ARRAY[]::text[]
  END AS blocking_reasons;
