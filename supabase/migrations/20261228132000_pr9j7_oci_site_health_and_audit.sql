-- PR-9J.7: per-site OCI health view and end-to-end audit RPC.

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS public.oci_site_health_v1;

CREATE MATERIALIZED VIEW public.oci_site_health_v1 AS
WITH queue AS (
  SELECT
    q.site_id,
    count(*)::integer AS queue_rows,
    count(*) FILTER (WHERE q.status = 'QUEUED')::integer AS queued_count,
    count(*) FILTER (WHERE q.status = 'RETRY')::integer AS retry_count,
    count(*) FILTER (WHERE q.status = 'PROCESSING' AND q.claimed_at < now() - interval '30 minutes')::integer AS processing_orphan_count,
    count(*) FILTER (WHERE q.status IN ('COMPLETED', 'UPLOADED', 'COMPLETED_UNVERIFIED') AND q.updated_at >= now() - interval '24 hours')::integer AS daily_completed_count,
    percentile_disc(0.95) WITHIN GROUP (
      ORDER BY extract(epoch FROM (now() - q.created_at))
    ) FILTER (WHERE q.status IN ('QUEUED', 'RETRY'))::bigint AS queued_age_p95_seconds,
    max(q.updated_at) FILTER (WHERE q.status IN ('COMPLETED', 'UPLOADED', 'COMPLETED_UNVERIFIED')) AS last_successful_run_at
  FROM public.offline_conversion_queue q
  WHERE q.provider_key = 'google_ads'
  GROUP BY q.site_id
),
dupes AS (
  SELECT site_id, count(*)::integer AS external_id_dupe_attempts_24h
  FROM (
    SELECT q.site_id, q.provider_key, q.external_id
    FROM public.offline_conversion_queue q
    WHERE q.provider_key = 'google_ads'
      AND q.created_at >= now() - interval '24 hours'
    GROUP BY q.site_id, q.provider_key, q.external_id
    HAVING count(*) > 1
  ) d
  GROUP BY site_id
)
SELECT
  s.id AS site_id,
  s.name AS site_name,
  COALESCE(q.queue_rows, 0) AS queue_rows,
  COALESCE(q.queued_count, 0) AS queued_count,
  COALESCE(q.retry_count, 0) AS retry_count,
  COALESCE(q.processing_orphan_count, 0) AS processing_orphan_count,
  COALESCE(q.daily_completed_count, 0) AS daily_completed_count,
  q.queued_age_p95_seconds,
  COALESCE(d.external_id_dupe_attempts_24h, 0) AS external_id_dupe_attempts_24h,
  v.last_seen_at AS script_last_seen_at,
  v.script_version,
  q.last_successful_run_at,
  now() AS refreshed_at
FROM public.sites s
LEFT JOIN queue q ON q.site_id = s.id
LEFT JOIN dupes d ON d.site_id = s.id
LEFT JOIN public.oci_script_versions v ON v.site_id = s.id
WHERE s.oci_api_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS oci_site_health_v1_site_id_idx
ON public.oci_site_health_v1 (site_id);

REVOKE ALL ON public.oci_site_health_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.oci_site_health_v1 TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_oci_site_health_v1()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.oci_site_health_v1;
$$;

REVOKE ALL ON FUNCTION public.refresh_oci_site_health_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_oci_site_health_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.audit_site_conversion_pipeline_v1(
  p_site_id uuid,
  p_from timestamptz DEFAULT now() - interval '7 days',
  p_to timestamptz DEFAULT now()
)
RETURNS TABLE(
  site_id uuid,
  calls_count integer,
  outbox_total integer,
  outbox_processed integer,
  outbox_failed integer,
  queue_total integer,
  queue_ready integer,
  queue_processing_orphan integer,
  queue_completed integer,
  queue_failed integer,
  queue_dlq integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    p_site_id,
    (SELECT count(*)::integer FROM public.calls c WHERE c.site_id = p_site_id AND c.created_at >= p_from AND c.created_at < p_to),
    (SELECT count(*)::integer FROM public.outbox_events o WHERE o.site_id = p_site_id AND o.created_at >= p_from AND o.created_at < p_to),
    (SELECT count(*)::integer FROM public.outbox_events o WHERE o.site_id = p_site_id AND o.status = 'PROCESSED' AND o.created_at >= p_from AND o.created_at < p_to),
    (SELECT count(*)::integer FROM public.outbox_events o WHERE o.site_id = p_site_id AND o.status = 'FAILED' AND o.created_at >= p_from AND o.created_at < p_to),
    (SELECT count(*)::integer FROM public.offline_conversion_queue q WHERE q.site_id = p_site_id AND q.provider_key = 'google_ads' AND q.created_at >= p_from AND q.created_at < p_to),
    (SELECT count(*)::integer FROM public.offline_conversion_queue q WHERE q.site_id = p_site_id AND q.provider_key = 'google_ads' AND q.status IN ('QUEUED', 'RETRY') AND q.created_at >= p_from AND q.created_at < p_to),
    (SELECT count(*)::integer FROM public.offline_conversion_queue q WHERE q.site_id = p_site_id AND q.provider_key = 'google_ads' AND q.status = 'PROCESSING' AND q.claimed_at < now() - interval '30 minutes' AND q.created_at >= p_from AND q.created_at < p_to),
    (SELECT count(*)::integer FROM public.offline_conversion_queue q WHERE q.site_id = p_site_id AND q.provider_key = 'google_ads' AND q.status IN ('COMPLETED', 'UPLOADED', 'COMPLETED_UNVERIFIED') AND q.created_at >= p_from AND q.created_at < p_to),
    (SELECT count(*)::integer FROM public.offline_conversion_queue q WHERE q.site_id = p_site_id AND q.provider_key = 'google_ads' AND q.status = 'FAILED' AND q.created_at >= p_from AND q.created_at < p_to),
    (SELECT count(*)::integer FROM public.offline_conversion_queue q WHERE q.site_id = p_site_id AND q.provider_key = 'google_ads' AND q.status = 'DEAD_LETTER_QUARANTINE' AND q.created_at >= p_from AND q.created_at < p_to);
END;
$$;

REVOKE ALL ON FUNCTION public.audit_site_conversion_pipeline_v1(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_site_conversion_pipeline_v1(uuid, timestamptz, timestamptz) TO service_role;

COMMIT;
