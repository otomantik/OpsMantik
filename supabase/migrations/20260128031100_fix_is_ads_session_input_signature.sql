-- Migration: Fix is_ads_session_input signature for PostgREST RPC lookup
-- Date: 2026-01-28
--
-- PostgREST resolves overloaded RPCs by parameter order. Supabase JS passes named args,
-- and PostgREST appears to look up the function using a canonical parameter ordering.
-- We align the signature to the observed lookup order:
--   (p_attribution_source, p_gbraid, p_gclid, p_utm_medium, p_utm_source, p_wbraid)

BEGIN;

DROP FUNCTION IF EXISTS public.is_ads_session_input(text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.is_ads_session_input(
  p_attribution_source text,
  p_gbraid text,
  p_gclid text,
  p_utm_medium text,
  p_utm_source text,
  p_wbraid text
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
    (gclid IS NOT NULL OR wbraid IS NOT NULL OR gbraid IS NOT NULL)
    OR
    (attribution_source IS NOT NULL AND (
      attribution_source LIKE '%paid%'
      OR attribution_source LIKE '%ads%'
      OR attribution_source LIKE '%cpc%'
      OR attribution_source LIKE '%ppc%'
    ))
    OR
    (utm_medium IS NOT NULL AND (
      utm_medium IN ('cpc', 'ppc', 'paid', 'paidsearch', 'paid-search', 'sem', 'display', 'retargeting', 'remarketing')
      OR utm_medium LIKE '%cpc%'
      OR utm_medium LIKE '%ppc%'
      OR utm_medium LIKE '%paid%'
      OR utm_medium LIKE '%display%'
    ))
    OR
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

-- Update composite wrapper to call new signature order.
CREATE OR REPLACE FUNCTION public.is_ads_session(sess public.sessions)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.is_ads_session_input(
    sess.attribution_source,
    sess.gbraid,
    sess.gclid,
    NULL,
    NULL,
    sess.wbraid
  );
$$;

-- Re-apply permissions
REVOKE ALL ON FUNCTION public.is_ads_session_input(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ads_session_input(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ads_session_input(text, text, text, text, text, text) TO service_role;

COMMIT;

