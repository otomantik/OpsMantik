-- Migration: Fix RAISE syntax in dashboard session RPCs
-- Date: 2026-01-28

BEGIN;

CREATE OR REPLACE FUNCTION public.get_session_details(
  p_site_id uuid,
  p_session_id uuid
)
RETURNS TABLE (
  id uuid,
  site_id uuid,
  created_at timestamptz,
  created_month date,
  city text,
  district text,
  device_type text,
  attribution_source text,
  gclid text,
  fingerprint text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'not_authenticated',
      DETAIL = 'User must be authenticated',
      ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sites s
    WHERE s.id = p_site_id
      AND (
        s.user_id = v_user_id
        OR EXISTS (
          SELECT 1 FROM public.site_members sm
          WHERE sm.site_id = s.id AND sm.user_id = v_user_id
        )
        OR public.is_admin(v_user_id)
      )
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'access_denied',
      DETAIL = 'Access denied to this site',
      ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    sess.id,
    sess.site_id,
    sess.created_at,
    sess.created_month,
    sess.city,
    sess.district,
    sess.device_type,
    sess.attribution_source,
    sess.gclid,
    sess.fingerprint
  FROM public.sessions sess
  WHERE sess.id = p_session_id
    AND sess.site_id = p_site_id
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sessions_by_fingerprint(
  p_site_id uuid,
  p_fingerprint text,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  attribution_source text,
  device_type text,
  city text,
  lead_score int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_limit int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'not_authenticated',
      DETAIL = 'User must be authenticated',
      ERRCODE = 'P0001';
  END IF;

  IF p_fingerprint IS NULL OR length(p_fingerprint) = 0 THEN
    RETURN;
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 20), 50));

  IF NOT EXISTS (
    SELECT 1
    FROM public.sites s
    WHERE s.id = p_site_id
      AND (
        s.user_id = v_user_id
        OR EXISTS (
          SELECT 1 FROM public.site_members sm
          WHERE sm.site_id = s.id AND sm.user_id = v_user_id
        )
        OR public.is_admin(v_user_id)
      )
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'access_denied',
      DETAIL = 'Access denied to this site',
      ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    sess.id,
    sess.created_at,
    sess.attribution_source,
    sess.device_type,
    sess.city,
    sess.lead_score
  FROM public.sessions sess
  WHERE sess.site_id = p_site_id
    AND sess.fingerprint = p_fingerprint
  ORDER BY sess.created_at DESC, sess.id DESC
  LIMIT v_limit;
END;
$$;

COMMIT;

