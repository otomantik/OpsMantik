-- Migration: ADS Command Center - is_ads_session_input helper + composite wrapper
-- Date: 2026-01-28
--
-- Inputs supported (explicit):
-- - gclid / wbraid / gbraid
-- - utm_source / utm_medium
-- - attribution_source
--
-- Note: sessions table currently stores click IDs + attribution_source but not utm_* columns.
-- This helper is the single source of truth for Ads classification logic. Callers that have utm_* should pass them.

BEGIN;

-- RPC-callable helper (explicit inputs)
CREATE OR REPLACE FUNCTION public.is_ads_session_input(
  p_gclid text,
  p_wbraid text,
  p_gbraid text,
  p_utm_source text,
  p_utm_medium text,
  p_attribution_source text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  WITH norm AS (
    SELECT
      NULLIF(BTRIM(COALESCE(p_gclid, '')), '') AS gclid,
      NULLIF(BTRIM(COALESCE(p_wbraid, '')), '') AS wbraid,
      NULLIF(BTRIM(COALESCE(p_gbraid, '')), '') AS gbraid,
      LOWER(NULLIF(BTRIM(COALESCE(p_utm_source, '')), '')) AS utm_source,
      LOWER(NULLIF(BTRIM(COALESCE(p_utm_medium, '')), '')) AS utm_medium,
      LOWER(NULLIF(BTRIM(COALESCE(p_attribution_source, '')), '')) AS attribution_source
  )
  SELECT
    -- Any click-id means Ads-origin
    (gclid IS NOT NULL OR wbraid IS NOT NULL OR gbraid IS NOT NULL)
    OR
    -- Attribution classifier indicates paid/ads
    (attribution_source IS NOT NULL AND (
      attribution_source LIKE '%paid%'
      OR attribution_source LIKE '%ads%'
      OR attribution_source LIKE '%cpc%'
      OR attribution_source LIKE '%ppc%'
    ))
    OR
    -- UTM medium indicates paid acquisition
    (utm_medium IS NOT NULL AND (
      utm_medium IN ('cpc', 'ppc', 'paid', 'paidsearch', 'paid-search', 'sem', 'display', 'retargeting', 'remarketing')
      OR utm_medium LIKE '%cpc%'
      OR utm_medium LIKE '%ppc%'
      OR utm_medium LIKE '%paid%'
      OR utm_medium LIKE '%display%'
    ))
    OR
    -- UTM source indicates common ads networks (keep conservative)
    (utm_source IS NOT NULL AND (
      utm_source IN ('google', 'googleads', 'adwords', 'gads', 'meta', 'facebook', 'fb', 'instagram', 'tiktok', 'bing', 'microsoft')
      OR utm_source LIKE '%google%'
      OR utm_source LIKE '%adwords%'
      OR utm_source LIKE '%gads%'
    ))
  FROM norm;
$$;

COMMENT ON FUNCTION public.is_ads_session_input(text, text, text, text, text, text)
IS 'Single source of truth: Ads-origin session classifier using click IDs, utm_source/utm_medium, and attribution_source.';

-- Composite wrapper: keep existing name used by session RPCs, delegate to input helper.
-- (utm_* are not stored on sessions yet, so pass NULL for those)
CREATE OR REPLACE FUNCTION public.is_ads_session(sess public.sessions)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.is_ads_session_input(
    sess.gclid,
    sess.wbraid,
    sess.gbraid,
    NULL,
    NULL,
    sess.attribution_source
  );
$$;

COMMENT ON FUNCTION public.is_ads_session(public.sessions)
IS 'Ads-origin classifier for sessions row. Delegates to is_ads_session_input().';

-- Allow calling from PostgREST RPC endpoint (safe: returns boolean only)
REVOKE ALL ON FUNCTION public.is_ads_session_input(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ads_session_input(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ads_session_input(text, text, text, text, text, text) TO service_role;

COMMIT;

