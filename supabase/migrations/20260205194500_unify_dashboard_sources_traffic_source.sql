-- Migration: Unify dashboard "sources" to sessions.traffic_source (single source of truth)
-- Date: 2026-02-05
--
-- Problem:
-- - Different dashboards/RPCs used different dimensions:
--   - get_traffic_source_breakdown_v1 → sessions.traffic_source (channel classifier)
--   - get_dashboard_breakdown_v1      → sessions.attribution_source buckets (legacy)
-- - This caused inconsistencies (e.g. Direct counted as SEO/Organic in other report).
--
-- Fix:
-- 1) Backfill sessions.traffic_source / traffic_medium where missing (best-effort).
-- 2) Update get_dashboard_breakdown_v1 "sources" to use sessions.traffic_source.
-- 3) Keep output shape unchanged: { total_sessions, sources[], locations[], devices[] }.
-- 4) Use half-open ranges [from, to) for consistency across RPCs.
--
-- Notes:
-- - Backfill is limited to last 365 days to avoid full-table rewrites on large datasets.
-- - If you need older history, rerun the UPDATE without the created_at window.

BEGIN;

-- Ensure columns exist (idempotent; created earlier in 20260205150000)
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS traffic_source text,
  ADD COLUMN IF NOT EXISTS traffic_medium text;

-- ---------------------------------------------------------------------------
-- 1) Backfill traffic_source/traffic_medium where missing (best-effort)
-- ---------------------------------------------------------------------------
UPDATE public.sessions s
SET
  traffic_source = CASE
    -- Paid click IDs (Google). Note: this DB-level backfill uses only session columns.
    WHEN COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
    THEN 'Google Ads'

    -- Explicit paid UTMs
    WHEN LOWER(COALESCE(NULLIF(BTRIM(s.utm_medium), ''), '')) IN (
      'cpc','ppc','paid','ads','paidsearch','paid_search','sem','display','retargeting','remarketing',
      'paid-social','paid_social'
    )
    THEN COALESCE(NULLIF(BTRIM(s.utm_source), ''), 'Paid')

    -- Organic search referrer (strict, best-effort)
    WHEN COALESCE(NULLIF(BTRIM(s.referrer_host), ''), NULL) IS NOT NULL
      AND (
        s.referrer_host ILIKE '%google.%' OR
        s.referrer_host ILIKE '%bing.%' OR
        s.referrer_host ILIKE '%yandex.%' OR
        s.referrer_host ILIKE '%duckduckgo.%'
      )
    THEN 'SEO'

    -- Social referrer (best-effort)
    WHEN COALESCE(NULLIF(BTRIM(s.referrer_host), ''), NULL) IS NOT NULL
      AND (
        s.referrer_host ILIKE '%facebook.%' OR s.referrer_host IN ('l.facebook.com','m.facebook.com') OR
        s.referrer_host ILIKE '%instagram.%' OR s.referrer_host = 'l.instagram.com' OR
        s.referrer_host = 't.co' OR s.referrer_host ILIKE '%twitter.%' OR
        s.referrer_host ILIKE '%linkedin.%' OR
        s.referrer_host ILIKE '%tiktok.%' OR
        s.referrer_host ILIKE '%youtube.%' OR s.referrer_host = 'youtu.be'
      )
    THEN 'Social'

    -- Any other external referrer
    WHEN COALESCE(NULLIF(BTRIM(s.referrer_host), ''), NULL) IS NOT NULL
    THEN 'Referral'

    -- No referrer + no paid params → Direct
    ELSE 'Direct'
  END,

  traffic_medium = CASE
    WHEN COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
    THEN 'cpc'

    WHEN LOWER(COALESCE(NULLIF(BTRIM(s.utm_medium), ''), '')) IN (
      'cpc','ppc','paid','ads','paidsearch','paid_search','sem','display','retargeting','remarketing',
      'paid-social','paid_social'
    )
    THEN 'cpc'

    WHEN COALESCE(NULLIF(BTRIM(s.referrer_host), ''), NULL) IS NOT NULL
      AND (
        s.referrer_host ILIKE '%google.%' OR
        s.referrer_host ILIKE '%bing.%' OR
        s.referrer_host ILIKE '%yandex.%' OR
        s.referrer_host ILIKE '%duckduckgo.%'
      )
    THEN 'organic'

    WHEN COALESCE(NULLIF(BTRIM(s.referrer_host), ''), NULL) IS NOT NULL
      AND (
        s.referrer_host ILIKE '%facebook.%' OR s.referrer_host IN ('l.facebook.com','m.facebook.com') OR
        s.referrer_host ILIKE '%instagram.%' OR s.referrer_host = 'l.instagram.com' OR
        s.referrer_host = 't.co' OR s.referrer_host ILIKE '%twitter.%' OR
        s.referrer_host ILIKE '%linkedin.%' OR
        s.referrer_host ILIKE '%tiktok.%' OR
        s.referrer_host ILIKE '%youtube.%' OR s.referrer_host = 'youtu.be'
      )
    THEN 'social'

    WHEN COALESCE(NULLIF(BTRIM(s.referrer_host), ''), NULL) IS NOT NULL
    THEN 'referral'

    ELSE 'direct'
  END
WHERE (s.traffic_source IS NULL OR BTRIM(s.traffic_source) = '')
  AND s.created_at >= (NOW() - INTERVAL '365 days');

-- ---------------------------------------------------------------------------
-- 2) Unify get_dashboard_breakdown_v1 sources to traffic_source
-- ---------------------------------------------------------------------------
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

  -- Total sessions: half-open [from, to)
  SELECT COUNT(*) INTO v_total
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_at >= p_date_from
    AND s.created_at < p_date_to
    AND s.created_month BETWEEN v_month_from AND v_month_to
    AND (NOT p_ads_only OR public.is_ads_session(s));

  v_total := COALESCE(v_total, 0);

  -- Sources: ads_only=true stays simplified; ads_only=false uses traffic_source (canonical).
  IF p_ads_only THEN
    v_sources := jsonb_build_array(
      jsonb_build_object('name', 'Google Ads', 'count', v_total, 'pct', CASE WHEN v_total > 0 THEN ROUND(100.0, 1) ELSE 0 END),
      jsonb_build_object('name', 'Other', 'count', 0, 'pct', 0)
    );
  ELSE
    WITH base AS (
      SELECT
        COALESCE(
          NULLIF(BTRIM(COALESCE(s.traffic_source, '')), ''),
          -- Fallbacks for older rows where traffic_source may be missing
          CASE
            WHEN public.is_ads_session(s) THEN 'Google Ads'
            WHEN s.attribution_source IS NOT NULL AND s.attribution_source ILIKE '%Paid Social%' THEN 'Paid Social'
            WHEN s.attribution_source IS NOT NULL AND s.attribution_source ILIKE '%Organic%' THEN 'SEO'
            WHEN s.referrer_host IS NOT NULL AND BTRIM(s.referrer_host) <> '' THEN 'Referral'
            ELSE 'Direct'
          END
        ) AS bucket
      FROM public.sessions s
      WHERE s.site_id = p_site_id
        AND s.created_at >= p_date_from
        AND s.created_at < p_date_to
        AND s.created_month BETWEEN v_month_from AND v_month_to
    ),
    agg AS (
      SELECT bucket, COUNT(*)::bigint AS cnt
      FROM base
      GROUP BY bucket
    )
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', bucket,
        'count', cnt,
        'pct', CASE WHEN v_total > 0 THEN ROUND((cnt::numeric * 100.0 / v_total), 1) ELSE 0 END
      )
      ORDER BY cnt DESC
    ) INTO v_sources
    FROM agg;
    v_sources := COALESCE(v_sources, '[]'::jsonb);
  END IF;

  -- Locations (Merkez-safe) — keep same logic, but half-open range.
  WITH base AS (
    SELECT
      CASE
        WHEN NULLIF(BTRIM(COALESCE(s.district, '')), '') = 'Merkez'
             AND NULLIF(BTRIM(COALESCE(s.city, '')), '') IS NOT NULL
        THEN BTRIM(s.city) || ' (Merkez)'
        WHEN NULLIF(BTRIM(COALESCE(s.district, '')), '') IS NOT NULL
             AND NULLIF(BTRIM(COALESCE(s.city, '')), '') IS NOT NULL
             AND BTRIM(s.district) = BTRIM(s.city)
        THEN BTRIM(s.city)
        WHEN NULLIF(BTRIM(COALESCE(s.district, '')), '') IS NOT NULL
             AND NULLIF(BTRIM(COALESCE(s.city, '')), '') IS NOT NULL
        THEN BTRIM(s.district) || ' / ' || BTRIM(s.city)
        WHEN NULLIF(BTRIM(COALESCE(s.city, '')), '') IS NOT NULL
        THEN BTRIM(s.city)
        ELSE 'Unknown'
      END AS loc
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

  -- Devices: half-open range.
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
IS 'Dashboard breakdown v1 (unified): sources use sessions.traffic_source (canonical), locations handle Merkez, devices buckets. Half-open ranges [from,to). ads_only=true filters is_ads_session(s).';

GRANT EXECUTE ON FUNCTION public.get_dashboard_breakdown_v1(uuid, timestamptz, timestamptz, boolean) TO anon, authenticated, service_role;

COMMIT;

