-- Migration: ADS Command Center - Ads session predicate (single source of truth)
-- Date: 2026-01-28
--
-- Rule: A session is considered "Ads-origin" if:
-- - Any Google click-id exists: gclid OR wbraid OR gbraid
-- - OR attribution_source indicates paid traffic (computed classifier)
--
-- Single source of truth: public.is_ads_session(public.sessions)

BEGIN;

CREATE OR REPLACE FUNCTION public.is_ads_session(sess public.sessions)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(sess.gclid, '') <> ''
    OR COALESCE(sess.wbraid, '') <> ''
    OR COALESCE(sess.gbraid, '') <> ''
    OR (
      sess.attribution_source IS NOT NULL
      AND (
        sess.attribution_source ILIKE '%paid%'
        OR sess.attribution_source ILIKE '%ads%'
      )
    );
$$;

COMMENT ON FUNCTION public.is_ads_session(public.sessions)
IS 'Single source of truth: returns true iff session is Ads-origin (click IDs or paid/ads attribution_source).';

COMMIT;

