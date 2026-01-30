-- P4-1 Breakdown: single RPC returning sources (top 5 + Other), locations (top 8 + Other), devices (Mobile/Desktop/Other + Unknown).
-- Hard rules: p_date_from/p_date_to authoritative (no TZ shift); partition pruning (created_month + created_at);
-- p_ads_only=true STRICT: sessions filtered ONLY by click-id (gclid/wbraid/gbraid), NOT attribution_source LIKE '%paid%'.
-- NULL/empty dims: city, district, device_type -> 'Unknown'. Devices: 3 buckets + Unknown.

BEGIN;

-- Strict ads predicate: click-id only (no attribution_source; avoids inflation).
CREATE OR REPLACE FUNCTION public.is_ads_session_click_id_only(sess public.sessions)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(NULLIF(BTRIM(COALESCE(sess.gclid, '')), ''), NULL) IS NOT NULL
    OR COALESCE(NULLIF(BTRIM(COALESCE(sess.wbraid, '')), ''), NULL) IS NOT NULL
    OR COALESCE(NULLIF(BTRIM(COALESCE(sess.gbraid, '')), ''), NULL) IS NOT NULL;
$$;

COMMENT ON FUNCTION public.is_ads_session_click_id_only(public.sessions)
IS 'P4: Strict ads filter for breakdown — click-id only (gclid/wbraid/gbraid). Do not use attribution_source.';

-- Single JSON breakdown: sources (top 5 + Other), locations (top 8 + Other), devices (Mobile/Desktop/Other + Unknown).
CREATE OR REPLACE FUNCTION public.get_dashboard_breakdown_p4(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_ads_only boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_sources jsonb;
  v_locations jsonb;
  v_devices jsonb;
  v_total_sessions bigint;
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';

  -- Total sessions in range (for percentages). p_ads_only=true: STRICT click-id only.
  SELECT COUNT(*) INTO v_total_sessions
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_month >= v_start_month
    AND s.created_month < v_end_month
    AND s.created_at >= p_date_from
    AND s.created_at < p_date_to
    AND (NOT p_ads_only OR public.is_ads_session_click_id_only(s));

  v_total_sessions := COALESCE(v_total_sessions, 0);

  -- Sources: top 5 + Other. Dimension = COALESCE(NULLIF(TRIM(attribution_source),''), 'Unknown').
  WITH base AS (
    SELECT COALESCE(NULLIF(BTRIM(COALESCE(s.attribution_source, '')), ''), 'Unknown') AS dim
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND (NOT p_ads_only OR public.is_ads_session_click_id_only(s))
  ),
  agg AS (
    SELECT dim, COUNT(*)::bigint AS cnt
    FROM base
    GROUP BY dim
    ORDER BY cnt DESC
  ),
  top5 AS (
    SELECT dim, cnt, ROW_NUMBER() OVER (ORDER BY cnt DESC) AS rn FROM agg
  ),
  with_other AS (
    SELECT
      CASE WHEN rn <= 5 THEN dim ELSE 'Other' END AS label,
      cnt
    FROM top5
  ),
  merged AS (
    SELECT label, SUM(cnt)::bigint AS cnt
    FROM with_other
    GROUP BY label
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'label', label,
      'count', cnt,
      'percentage', CASE WHEN v_total_sessions > 0 THEN ROUND((cnt::numeric / v_total_sessions::numeric) * 100, 2) ELSE 0 END
    ) ORDER BY cnt DESC
  ) INTO v_sources
  FROM merged;

  -- Locations: top 8 + Other. District preferred, fallback city. NULL/empty -> 'Unknown'.
  WITH base AS (
    SELECT COALESCE(
      NULLIF(BTRIM(COALESCE(s.district, '')), ''),
      NULLIF(BTRIM(COALESCE(s.city, '')), ''),
      'Unknown'
    ) AS dim
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND (NOT p_ads_only OR public.is_ads_session_click_id_only(s))
  ),
  agg AS (
    SELECT dim, COUNT(*)::bigint AS cnt
    FROM base
    GROUP BY dim
    ORDER BY cnt DESC
  ),
  top8 AS (
    SELECT dim, cnt, ROW_NUMBER() OVER (ORDER BY cnt DESC) AS rn FROM agg
  ),
  with_other AS (
    SELECT
      CASE WHEN rn <= 8 THEN dim ELSE 'Other' END AS label,
      cnt
    FROM top8
  ),
  merged AS (
    SELECT label, SUM(cnt)::bigint AS cnt
    FROM with_other
    GROUP BY label
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'label', label,
      'count', cnt,
      'percentage', CASE WHEN v_total_sessions > 0 THEN ROUND((cnt::numeric / v_total_sessions::numeric) * 100, 2) ELSE 0 END
    ) ORDER BY cnt DESC
  ) INTO v_locations
  FROM merged;

  -- Devices: 3 buckets (Mobile, Desktop, Other) + Unknown. NULL/empty -> 'Unknown'.
  WITH base AS (
    SELECT
      CASE
        WHEN NULLIF(BTRIM(COALESCE(s.device_type, '')), '') IS NULL THEN 'Unknown'
        WHEN LOWER(TRIM(s.device_type)) IN ('mobile', 'phone', 'tablet')
          OR LOWER(TRIM(s.device_type)) LIKE '%mobile%'
          OR LOWER(TRIM(s.device_type)) LIKE '%phone%'
          OR LOWER(TRIM(s.device_type)) LIKE '%tablet%' THEN 'Mobile'
        WHEN LOWER(TRIM(s.device_type)) LIKE '%desktop%' THEN 'Desktop'
        ELSE 'Other'
      END AS dim
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND (NOT p_ads_only OR public.is_ads_session_click_id_only(s))
  ),
  agg AS (
    SELECT dim, COUNT(*)::bigint AS cnt
    FROM base
    GROUP BY dim
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'label', dim,
      'count', cnt,
      'percentage', CASE WHEN v_total_sessions > 0 THEN ROUND((cnt::numeric / v_total_sessions::numeric) * 100, 2) ELSE 0 END
    ) ORDER BY cnt DESC
  ) INTO v_devices
  FROM agg;

  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'date_from', p_date_from,
    'date_to', p_date_to,
    'ads_only', p_ads_only,
    'total_sessions', v_total_sessions,
    'sources', COALESCE(v_sources, '[]'::jsonb),
    'locations', COALESCE(v_locations, '[]'::jsonb),
    'devices', COALESCE(v_devices, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_breakdown_p4(uuid, timestamptz, timestamptz, boolean)
IS 'P4-1 Breakdown: sources (top 5 + Other), locations (top 8 + Other), devices (Mobile/Desktop/Other + Unknown). p_ads_only=true uses click-id only.';

GRANT EXECUTE ON FUNCTION public.get_dashboard_breakdown_p4(uuid, timestamptz, timestamptz, boolean) TO anon, authenticated, service_role;

COMMIT;
