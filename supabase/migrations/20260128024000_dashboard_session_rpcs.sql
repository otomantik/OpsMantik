-- Migration: Dashboard P0 - Session RPCs (eliminate client reads from public.sessions)
-- Date: 2026-01-28
-- Purpose:
-- 1) get_session_details(p_site_id uuid, p_session_id uuid)
-- 2) get_sessions_by_fingerprint(p_site_id uuid, p_fingerprint text, p_limit int)
--
-- Security:
-- - SECURITY DEFINER (explicit membership check; restrict fields)
-- - Fail-closed: require auth.uid() non-null and caller must access site via owner/member/admin
-- - Explicitly grants EXECUTE to authenticated only

BEGIN;

-- Helper: enforce site access (owner OR member OR admin)
-- Note: keep as inline checks in each function to avoid extra surface area.

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
    RAISE EXCEPTION 'not_authenticated' USING MESSAGE = 'User must be authenticated';
  END IF;

  -- Access check: owner OR member OR admin (Iron Dome rule)
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
    RAISE EXCEPTION 'access_denied' USING MESSAGE = 'Access denied to this site';
  END IF;

  -- Return minimal required fields (no IP / user_agent)
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

COMMENT ON FUNCTION public.get_session_details(uuid, uuid)
IS 'Dashboard RPC: return minimal session fields for SessionDrawer/SessionGroup. Enforces site access (owner/member/admin).';

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
    RAISE EXCEPTION 'not_authenticated' USING MESSAGE = 'User must be authenticated';
  END IF;

  IF p_fingerprint IS NULL OR length(p_fingerprint) = 0 THEN
    -- Fail-closed: no fingerprint means no data
    RETURN;
  END IF;

  -- Clamp limit defensively (fail-closed upper bound)
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 20), 50));

  -- Access check: owner OR member OR admin (Iron Dome rule)
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
    RAISE EXCEPTION 'access_denied' USING MESSAGE = 'Access denied to this site';
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

COMMENT ON FUNCTION public.get_sessions_by_fingerprint(uuid, text, int)
IS 'Dashboard RPC: return last N sessions for a fingerprint within a site. Enforces site access (owner/member/admin).';

-- Permissions: do not allow PUBLIC, only authenticated
REVOKE ALL ON FUNCTION public.get_session_details(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_sessions_by_fingerprint(uuid, text, int) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_session_details(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sessions_by_fingerprint(uuid, text, int) TO authenticated;

COMMIT;

