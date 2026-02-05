-- Fix location breakdown: handle "Merkez" + UTF-8 encoding
-- Problem 1: "Merkez" appears standalone without city context
-- Problem 2: UTF-8 characters display incorrectly (Kahramanmaraş → KahramanmaraÅ)
-- Solution: Apply same logic as formatLocation helper

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

  -- Total sessions (same filters as datasets)
  SELECT COUNT(*) INTO v_total
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_at BETWEEN p_date_from AND p_date_to
    AND s.created_month BETWEEN v_month_from AND v_month_to
    AND (NOT p_ads_only OR public.is_ads_session(s));

  v_total := COALESCE(v_total, 0);

  -- Sources
  IF p_ads_only THEN
    -- Simplified: Google Ads = 100%, Other = 0
    v_sources := jsonb_build_array(
      jsonb_build_object('name', 'Google Ads', 'count', v_total, 'pct', CASE WHEN v_total > 0 THEN ROUND(100.0, 1) ELSE 0 END),
      jsonb_build_object('name', 'Other', 'count', 0, 'pct', 0)
    );
  ELSE
    -- Classify: Paid Social, Organic, Google Ads, Direct/Unknown, Other
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
          AND s.created_at BETWEEN p_date_from AND p_date_to
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

  -- Locations: top 8 + Other
  -- Fix: Handle "Merkez" + maintain UTF-8 encoding
  -- Logic: district = 'Merkez' → "City (Merkez)"
  --        district = city → "City"
  --        district exists → "District / City"
  --        else → "City" or "Unknown"
  WITH base AS (
    SELECT
      CASE
        -- Case 1: district is "Merkez" → show "City (Merkez)"
        WHEN NULLIF(BTRIM(COALESCE(s.district, '')), '') = 'Merkez' 
             AND NULLIF(BTRIM(COALESCE(s.city, '')), '') IS NOT NULL
        THEN BTRIM(s.city) || ' (Merkez)'
        
        -- Case 2: district equals city → show just "City"
        WHEN NULLIF(BTRIM(COALESCE(s.district, '')), '') IS NOT NULL
             AND NULLIF(BTRIM(COALESCE(s.city, '')), '') IS NOT NULL
             AND BTRIM(s.district) = BTRIM(s.city)
        THEN BTRIM(s.city)
        
        -- Case 3: district exists and differs from city → show "District / City"
        WHEN NULLIF(BTRIM(COALESCE(s.district, '')), '') IS NOT NULL
             AND NULLIF(BTRIM(COALESCE(s.city, '')), '') IS NOT NULL
        THEN BTRIM(s.district) || ' / ' || BTRIM(s.city)
        
        -- Case 4: only city exists → show "City"
        WHEN NULLIF(BTRIM(COALESCE(s.city, '')), '') IS NOT NULL
        THEN BTRIM(s.city)
        
        -- Case 5: neither exists → "Unknown"
        ELSE 'Unknown'
      END AS loc
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_at BETWEEN p_date_from AND p_date_to
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

  -- Devices: Mobile (contains mobile), Desktop (contains desktop), null/empty -> Unknown, else Other
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
      AND s.created_at BETWEEN p_date_from AND p_date_to
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
IS 'P4-1 Breakdown v1: sources (ads_only=true: Google Ads+Other; false: Google Ads/Paid Social/Organic/Direct/Unknown/Other), locations (top 8+Other, handles Merkez smartly), devices (Mobile/Desktop/Other/Unknown). UTF-8 safe. Filter: is_ads_session(s) when p_ads_only=true.';
