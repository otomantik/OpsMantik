-- Attribution Forensic Layer: Diagnostic export for no-match / failed sync.
-- get_attribution_forensic_export_for_call: DIC fields + identity_resolution_score,
-- touchpoint_entropy (14d), cross_device_fingerprint_link, pre_normalization_snapshot,
-- failure_mode bucket, clids_discarded_count.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_attribution_forensic_export_for_call(p_call_id uuid, p_site_id uuid)
RETURNS TABLE(
  -- DIC baseline (same as get_dic_export_for_call)
  raw_phone_string text,
  phone_source_type text,
  detected_country_iso text,
  event_timestamp_utc_ms bigint,
  first_fingerprint_touch_utc_ms bigint,
  user_agent_raw text,
  historical_gclid_presence boolean,
  -- Signal Integrity Matrix
  identity_resolution_score numeric,
  touchpoint_entropy jsonb,
  -- Shadow Attribution Chain
  cross_device_fingerprint_link text,
  pre_normalization_snapshot jsonb,
  -- Failure Mode Categorization
  failure_mode text,
  -- Environmental Context
  clids_discarded_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH c AS (
    SELECT
      c.phone_number,
      c.phone_source_type,
      c.user_agent,
      c.matched_fingerprint,
      c.site_id,
      c.confirmed_at,
      c.matched_at,
      c.session_created_month
    FROM public.calls c
    WHERE c.id = p_call_id AND c.site_id = p_site_id
    LIMIT 1
  ),
  conv_time AS (
    SELECT COALESCE(c.confirmed_at, c.matched_at) AS t FROM c
  ),
  site_country AS (
    SELECT s.default_country_iso
    FROM public.sites s
    INNER JOIN c ON c.site_id = s.id
    LIMIT 1
  ),
  first_touch AS (
    SELECT MIN(s2.created_at) AS first_at
    FROM public.sessions s2
    INNER JOIN c ON c.site_id = s2.site_id AND c.matched_fingerprint IS NOT NULL AND s2.fingerprint = c.matched_fingerprint
    WHERE s2.created_at >= (SELECT t FROM conv_time) - interval '90 days'
  ),
  gclid_90d AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.sessions s2
      INNER JOIN c ON c.site_id = s2.site_id AND c.matched_fingerprint IS NOT NULL AND s2.fingerprint = c.matched_fingerprint
      WHERE s2.gclid IS NOT NULL
        AND s2.created_at >= (SELECT t FROM conv_time) - interval '90 days'
    ) AS has_gclid
  ),
  -- Touchpoint chain: last 14 days, same fingerprint (user_agents + IPs for Privacy Sandbox / GPC context)
  touchpoints_14d AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'user_agent', s2.user_agent,
        'ip_address', s2.ip_address,
        'created_at', s2.created_at
      ) ORDER BY s2.created_at
    ) AS chain
    FROM public.sessions s2
    INNER JOIN c ON c.site_id = s2.site_id AND c.matched_fingerprint IS NOT NULL AND s2.fingerprint = c.matched_fingerprint
    WHERE s2.created_at >= (SELECT t FROM conv_time) - interval '14 days'
  ),
  -- Cross-device / fingerprint link reason (multiple fingerprints for same phone, or IP/UA change)
  fingerprint_variation AS (
    SELECT
      (SELECT count(DISTINCT c2.matched_fingerprint) FROM public.calls c2
       WHERE c2.site_id = c.site_id AND c2.phone_number = c.phone_number
         AND c2.matched_at >= (SELECT t FROM conv_time) - interval '14 days'
         AND c2.matched_fingerprint IS NOT NULL) AS distinct_fp_for_phone,
      (SELECT count(DISTINCT s2.ip_address) FROM public.sessions s2
       INNER JOIN c ON c.site_id = s2.site_id AND c.matched_fingerprint IS NOT NULL AND s2.fingerprint = c.matched_fingerprint
       WHERE s2.created_at >= (SELECT t FROM conv_time) - interval '14 days' AND s2.ip_address IS NOT NULL) AS distinct_ips,
      (SELECT count(DISTINCT s2.user_agent) FROM public.sessions s2
       INNER JOIN c ON c.site_id = s2.site_id AND c.matched_fingerprint IS NOT NULL AND s2.fingerprint = c.matched_fingerprint
       WHERE s2.created_at >= (SELECT t FROM conv_time) - interval '14 days' AND s2.user_agent IS NOT NULL) AS distinct_uas
    FROM c
  ),
  link_reason AS (
    SELECT
      CASE
        WHEN (SELECT distinct_fp_for_phone FROM fingerprint_variation) > 1 THEN 'multiple_fingerprints'
        WHEN (SELECT distinct_ips FROM fingerprint_variation) > 1 THEN 'ip_change'
        WHEN (SELECT distinct_uas FROM fingerprint_variation) > 1 THEN 'browser_update'
        ELSE NULL
      END AS reason
    FROM c
    LIMIT 1
  ),
  -- Failure mode bucket: ORPHANED, SIGNAL_STALE, (HASH_MISMATCH / ATTRIBUTION_HIJACK left for pipeline/app)
  failure_bucket AS (
    SELECT
      CASE
        WHEN c.matched_fingerprint IS NULL THEN 'ORPHANED_CONVERSION'
        WHEN (SELECT first_at FROM first_touch) IS NULL THEN 'ORPHANED_CONVERSION'
        WHEN (SELECT t FROM conv_time) - (SELECT first_at FROM first_touch) > interval '30 days' THEN 'SIGNAL_STALE'
        ELSE NULL
      END AS mode
    FROM c
    LIMIT 1
  ),
  -- How many FAILED queue rows for this call had invalid/unparseable GCLID (decode / sentinel)
  discarded_clids AS (
    SELECT count(*)::bigint AS cnt
    FROM public.offline_conversion_queue oq
    WHERE oq.call_id = p_call_id AND oq.site_id = p_site_id
      AND oq.status = 'FAILED'
      AND (
        oq.provider_error_code IN ('INVALID_GCLID', 'UNPARSEABLE_GCLID')
        OR oq.last_error ILIKE '%decode%'
        OR oq.last_error ILIKE '%çözülemedi%'
        OR oq.last_error ILIKE '%GCLID%'
      )
  )
  SELECT
    c.phone_number AS raw_phone_string,
    c.phone_source_type,
    (SELECT default_country_iso FROM site_country) AS detected_country_iso,
    (EXTRACT(EPOCH FROM (SELECT t FROM conv_time)) * 1000)::bigint AS event_timestamp_utc_ms,
    (EXTRACT(EPOCH FROM (SELECT first_at FROM first_touch)) * 1000)::bigint AS first_fingerprint_touch_utc_ms,
    c.user_agent AS user_agent_raw,
    (SELECT has_gclid FROM gclid_90d) AS historical_gclid_presence,
    -- identity_resolution_score: 0-1 from phone "cleanliness" (digit length / pattern)
    CASE
      WHEN length(regexp_replace(c.phone_number, '\D', '', 'g')) BETWEEN 10 AND 15 THEN 1.0
      WHEN length(regexp_replace(c.phone_number, '\D', '', 'g')) >= 7 THEN 0.5
      ELSE 0.3
    END::numeric AS identity_resolution_score,
    (SELECT chain FROM touchpoints_14d) AS touchpoint_entropy,
    (SELECT reason FROM link_reason) AS cross_device_fingerprint_link,
    jsonb_build_object('raw_phone_string', c.phone_number, 'raw_user_agent', c.user_agent) AS pre_normalization_snapshot,
    (SELECT mode FROM failure_bucket) AS failure_mode,
    (SELECT cnt FROM discarded_clids) AS clids_discarded_count
  FROM c;
$$;

COMMENT ON FUNCTION public.get_attribution_forensic_export_for_call(uuid, uuid) IS
  'Attribution Forensic: DIC + identity_resolution_score, touchpoint_entropy (14d UA/IP chain), cross_device_fingerprint_link, pre_normalization_snapshot, failure_mode (ORPHANED_CONVERSION|SIGNAL_STALE), clids_discarded_count. For causal failure trace when conversion fails to sync.';

GRANT EXECUTE ON FUNCTION public.get_attribution_forensic_export_for_call(uuid, uuid) TO service_role;

COMMIT;
