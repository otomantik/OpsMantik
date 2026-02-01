-- Breakdown: use half-open range [from, to) like get_command_center_p0_stats_v2 for consistency.
-- Fixes mismatch where breakdown used BETWEEN (inclusive) and stats used < to (exclusive).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_dashboard_breakdown_v1(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_ads_only boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month_from date;
  v_month_to date;
  v_total bigint;
  v_sources jsonb;
  v_locations jsonb;
  v_devices jsonb;
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_month_from := DATE_TRUNC('month', p_date_from)::date;
  v_month_to   := DATE_TRUNC('month', p_date_to)::date;

  -- Total sessions: half-open [from, to) to match stats RPC
  SELECT COUNT(*) INTO v_total
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_at >= p_date_from
    AND s.created_at < p_date_to
    AND s.created_month BETWEEN v_month_from AND v_month_to
    AND (NOT p_ads_only OR public.is_ads_session(s));

  v_total := COALESCE(v_total, 0);

  -- Sources
  IF p_ads_only THEN
    v_sources := jsonb_build_array(
      jsonb_build_object('name', 'Google Ads', 'count', v_total, 'pct', CASE WHEN v_total > 0 THEN ROUND(100.0, 1) ELSE 0 END),
      jsonb_build_object('name', 'Other', 'count', 0, 'pct', 0)
    );
  ELSE
    WITH base AS (
      SELECT
        CASE
          WHEN s.attribution_source IS NOT NULL AND s.attribution_source ILIKE '%Paid Social%' THEN 'Paid Social'
          WHEN s.attribution_source IS NOT NULL AND s.attribution_source ILIKE '%Organic%' THEN 'Organic'
          WHEN public.is_ads_session(s) THEN 'Google Ads'
          WHEN s.attribution_source IS NULL OR BTRIM(COALESCE(s.attribution_source, '')) = '' THEN 'Direct/Unknown'
          ELSE 'Other'
        END AS bucket
        FROM public.sessions s
        WHERE s.site_id = p_site_id
          AND s.created_at >= p_date_from
          AND s.created_at < p_date_to
          AND s.created_month BETWEEN v_month_from AND v_month_to
      ),
      agg AS (
        SELECT bucket, COUNT(*)::bigint AS cnt FROM base GROUP BY bucket
      )
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', bucket,
        'count', cnt,
        'pct', CASE WHEN v_total > 0 THEN ROUND((cnt::numeric * 100.0 / v_total), 1) ELSE 0 END
      ) ORDER BY cnt DESC
    ) INTO v_sources
    FROM agg;
    v_sources := COALESCE(v_sources, '[]'::jsonb);
  END IF;

  -- Locations
  WITH base AS (
    SELECT COALESCE(
      NULLIF(BTRIM(COALESCE(s.district, '')), ''),
      NULLIF(BTRIM(COALESCE(s.city, '')), ''),
      'Unknown'
    ) AS loc
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND s.created_month BETWEEN v_month_from AND v_month_to
      AND (NOT p_ads_only OR public.is_ads_session(s))
  ),
  agg AS (
    SELECT loc, COUNT(*)::bigint AS cnt FROM base GROUP BY loc ORDER BY COUNT(*) DESC
  ),
  ranked AS (
    SELECT loc, cnt, ROW_NUMBER() OVER (ORDER BY cnt DESC) AS rn FROM agg
  ),
  merged AS (
    SELECT CASE WHEN rn <= 8 THEN loc ELSE 'Other' END AS name, SUM(cnt)::bigint AS cnt
    FROM ranked GROUP BY CASE WHEN rn <= 8 THEN loc ELSE 'Other' END
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'name', name,
      'count', cnt,
      'pct', CASE WHEN v_total > 0 THEN ROUND((cnt::numeric * 100.0 / v_total), 1) ELSE 0 END
    ) ORDER BY cnt DESC
  ) INTO v_locations
  FROM merged;
  v_locations := COALESCE(v_locations, '[]'::jsonb);

  -- Devices
  WITH base AS (
    SELECT
      CASE
        WHEN NULLIF(BTRIM(COALESCE(s.device_type, '')), '') IS NULL THEN 'Unknown'
        WHEN LOWER(s.device_type) LIKE '%mobile%' THEN 'Mobile'
        WHEN LOWER(s.device_type) LIKE '%desktop%' THEN 'Desktop'
        ELSE 'Other'
      END AS bucket
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND s.created_month BETWEEN v_month_from AND v_month_to
      AND (NOT p_ads_only OR public.is_ads_session(s))
  ),
  agg AS (
    SELECT bucket, COUNT(*)::bigint AS cnt FROM base GROUP BY bucket
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'name', bucket,
      'count', cnt,
      'pct', CASE WHEN v_total > 0 THEN ROUND((cnt::numeric * 100.0 / v_total), 1) ELSE 0 END
    ) ORDER BY cnt DESC
  ) INTO v_devices
  FROM agg;
  v_devices := COALESCE(v_devices, '[]'::jsonb);

  RETURN jsonb_build_object(
    'total_sessions', v_total,
    'sources', v_sources,
    'locations', v_locations,
    'devices', v_devices
  );
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_breakdown_v1(uuid, timestamptz, timestamptz, boolean)
IS 'P4-1 Breakdown v1: half-open range [from, to) to match stats RPC. Counts sessions (visits), not Google Ads API clicks.';

COMMIT;
