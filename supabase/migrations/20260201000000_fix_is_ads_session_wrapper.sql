-- Migration: Fix is_ads_session wrapper to pass UTM columns
-- Date: 2026-02-01
--
-- The previous wrapper was passing NULL for UTM source/medium, failing to classify
-- sessions that only have UTM parameters (no GCLID).

BEGIN;

CREATE OR REPLACE FUNCTION public.is_ads_session(sess public.sessions)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.is_ads_session_input(
    sess.attribution_source,
    sess.gbraid,
    sess.gclid,
    sess.utm_medium,
    sess.utm_source,
    sess.wbraid
  );
$$;

COMMIT;
