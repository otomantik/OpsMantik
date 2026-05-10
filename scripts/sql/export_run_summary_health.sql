-- @pack_id: export_run_summary_health
-- @contract_version: v1
-- @db_required: true
-- @policy_version: export_run_summary_health_v1
-- PR-9H.7F — oci_export_run_summaries hygiene (counts-only table).
-- Safe when table is missing: uses EXISTS guards before touching public.oci_export_run_summaries.

SELECT
  'export_run_summary_health_v1'::text AS policy_version,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = 'oci_export_run_summaries'
    )
      THEN 'GREEN'::text
    ELSE 'RED'::text
  END AS contract_status,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = 'oci_export_run_summaries'
    )
      THEN 'SCRIPT_SUMMARY_PERSISTENCE_PRESENT'::text
    ELSE 'SCRIPT_SUMMARY_PERSISTENCE_MISSING'::text
  END AS script_summary_persistence,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = 'oci_export_run_summaries'
    )
      THEN (
          SELECT COUNT(*)::bigint
          FROM public.oci_export_run_summaries s
          WHERE s.received_at > (now() - interval '30 days')
        )
    ELSE 0::bigint
  END AS recent_summaries_30d,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = 'oci_export_run_summaries'
    )
      THEN (SELECT MAX(received_at) FROM public.oci_export_run_summaries)
    ELSE NULL::timestamptz
  END AS latest_received_at,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = 'oci_export_run_summaries'
    )
      THEN (
          SELECT COUNT(*)::bigint
          FROM public.oci_export_run_summaries s
          WHERE length(trim(s.export_run_id)) = 0 OR s.export_run_id IS NULL
        )
    ELSE 0::bigint
  END AS empty_export_run_id_rows,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = 'oci_export_run_summaries'
    )
      THEN (
          SELECT COUNT(*)::bigint
          FROM public.oci_export_run_summaries s
          WHERE s.fetched_count < 0 OR s.claimed_count < 0 OR s.upload_attempted_count < 0
            OR s.upload_success_count < 0 OR s.upload_failed_count < 0 OR s.ack_success_count < 0
            OR s.ack_failed_count < 0 OR s.ack_skipped_count < 0 OR s.provider_ambiguous_pending_count < 0
        )
    ELSE 0::bigint
  END AS negative_count_violations,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = 'oci_export_run_summaries'
    )
      THEN (
          SELECT COUNT(*)::bigint
          FROM (
            SELECT export_run_id, site_id, provider_key, COUNT(*) AS c
            FROM public.oci_export_run_summaries
            GROUP BY 1, 2, 3
            HAVING COUNT(*) > 1
          ) d
        )
    ELSE 0::bigint
  END AS duplicate_key_violations,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = 'oci_export_run_summaries'
    )
      THEN (
          SELECT COUNT(*)::bigint
          FROM public.oci_export_run_summaries s
          WHERE s.status = 'SCRIPT_SUMMARY_MISMATCH'::text
        )
    ELSE 0::bigint
  END AS script_summary_mismatch_count,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = 'oci_export_run_summaries'
    )
      THEN (
          SELECT COUNT(*)::bigint
          FROM public.oci_export_run_summaries s
          WHERE s.status = 'SCRIPT_SUMMARY_RECONCILED'::text
        )
    ELSE 0::bigint
  END AS reconciled_row_count;
