-- DIC / Forensic: Use caller_phone when available. raw_phone_string = COALESCE(caller_phone_e164, phone_number).
-- Must DROP before CREATE when return type changes (PostgreSQL 42P13).

BEGIN;

DROP FUNCTION IF EXISTS public.get_dic_export_for_call(uuid, uuid);

-- get_dic_export_for_call: COALESCE identity, add is_verified
CREATE FUNCTION public.get_dic_export_for_call(p_call_id uuid, p_site_id uuid)
RETURNS TABLE(
  raw_phone_string text,
  phone_source_type text,
  detected_country_iso text,
  event_timestamp_utc_ms bigint,
  first_fingerprint_touch_utc_ms bigint,
  user_agent_raw text,
  historical_gclid_presence boolean,
  is_verified boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH c AS (
    SELECT
      c.phone_number,
      c.caller_phone_e164,
      c.caller_phone_raw,
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
    WHERE s2.created_at >= (SELECT COALESCE(c.confirmed_at, c.matched_at) FROM c) - interval '90 days'
  ),
  gclid_90d AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.sessions s2
      INNER JOIN c ON c.site_id = s2.site_id AND c.matched_fingerprint IS NOT NULL AND s2.fingerprint = c.matched_fingerprint
      WHERE s2.gclid IS NOT NULL
        AND s2.created_at >= (SELECT COALESCE(c.confirmed_at, c.matched_at) FROM c) - interval '90 days'
    ) AS has_gclid
  )
  SELECT
    COALESCE(c.caller_phone_e164, c.phone_number) AS raw_phone_string,
    c.phone_source_type,
    (SELECT default_country_iso FROM site_country) AS detected_country_iso,
    (EXTRACT(EPOCH FROM COALESCE(c.confirmed_at, c.matched_at)) * 1000)::bigint AS event_timestamp_utc_ms,
    (EXTRACT(EPOCH FROM (SELECT first_at FROM first_touch)) * 1000)::bigint AS first_fingerprint_touch_utc_ms,
    c.user_agent AS user_agent_raw,
    (SELECT has_gclid FROM gclid_90d) AS historical_gclid_presence,
    (c.caller_phone_e164 IS NOT NULL) AS is_verified
  FROM c;
$$;

COMMENT ON FUNCTION public.get_dic_export_for_call(uuid, uuid) IS
  'DIC: raw_phone_string = COALESCE(caller_phone_e164, phone_number). is_verified when operator-verified.';

GRANT EXECUTE ON FUNCTION public.get_dic_export_for_call(uuid, uuid) TO service_role;

-- get_attribution_forensic_export_for_call: COALESCE identity, pre_normalization_snapshot from caller_phone_raw, identity_resolution_score=1 when verified
CREATE OR REPLACE FUNCTION public.get_attribution_forensic_export_for_call(p_call_id uuid, p_site_id uuid)
RETURNS TABLE(
  raw_phone_string text,
  phone_source_type text,
  detected_country_iso text,
  event_timestamp_utc_ms bigint,
  first_fingerprint_touch_utc_ms bigint,
  user_agent_raw text,
  historical_gclid_presence boolean,
  identity_resolution_score numeric,
  touchpoint_entropy jsonb,
  cross_device_fingerprint_link text,
  pre_normalization_snapshot jsonb,
  failure_mode text,
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
      c.caller_phone_e164,
      c.caller_phone_raw,
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
    COALESCE(c.caller_phone_e164, c.phone_number) AS raw_phone_string,
    c.phone_source_type,
    (SELECT default_country_iso FROM site_country) AS detected_country_iso,
    (EXTRACT(EPOCH FROM (SELECT t FROM conv_time)) * 1000)::bigint AS event_timestamp_utc_ms,
    (EXTRACT(EPOCH FROM (SELECT first_at FROM first_touch)) * 1000)::bigint AS first_fingerprint_touch_utc_ms,
    c.user_agent AS user_agent_raw,
    (SELECT has_gclid FROM gclid_90d) AS historical_gclid_presence,
    CASE
      WHEN c.caller_phone_e164 IS NOT NULL THEN 1.0
      WHEN length(regexp_replace(COALESCE(c.phone_number, ''), '\D', '', 'g')) BETWEEN 10 AND 15 THEN 1.0
      WHEN length(regexp_replace(COALESCE(c.phone_number, ''), '\D', '', 'g')) >= 7 THEN 0.5
      ELSE 0.3
    END::numeric AS identity_resolution_score,
    (SELECT chain FROM touchpoints_14d) AS touchpoint_entropy,
    (SELECT reason FROM link_reason) AS cross_device_fingerprint_link,
    jsonb_build_object('raw_phone_string', COALESCE(c.caller_phone_raw, c.phone_number), 'raw_user_agent', c.user_agent) AS pre_normalization_snapshot,
    (SELECT mode FROM failure_bucket) AS failure_mode,
    (SELECT cnt FROM discarded_clids) AS clids_discarded_count
  FROM c;
$$;

COMMENT ON FUNCTION public.get_attribution_forensic_export_for_call(uuid, uuid) IS
  'Forensic: raw_phone_string=COALESCE(caller_phone_e164,phone_number). identity_resolution_score=1 when operator-verified. pre_normalization_snapshot uses caller_phone_raw when set.';

COMMIT;
