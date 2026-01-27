-- Migration: Live Inbox v1 - get_session_timeline RPC (lazy drawer)
-- Date: 2026-01-28
--
-- get_session_timeline(p_site_id uuid, p_session_id uuid, p_limit int default 100)
-- Returns recent events for a session (no prefetch for list rows).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_session_timeline(
  p_site_id uuid,
  p_session_id uuid,
  p_limit int DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  event_category text,
  event_action text,
  event_label text,
  url text,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_limit int;
  v_month date;
BEGIN
  v_user_id := auth.uid();
  v_role := auth.role();

  IF v_user_id IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION USING
        MESSAGE = 'not_authenticated',
        DETAIL = 'User must be authenticated',
        ERRCODE = 'P0001';
    END IF;
  ELSE
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
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));

  -- Ensure session belongs to site and is ads-only (command center rule)
  SELECT sess.created_month
  INTO v_month
  FROM public.sessions sess
  WHERE sess.id = p_session_id
    AND sess.site_id = p_site_id
    AND public.is_ads_session(sess)
  LIMIT 1;

  IF v_month IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.created_at,
    e.event_category,
    e.event_action,
    e.event_label,
    e.url,
    e.metadata
  FROM public.events e
  WHERE e.session_id = p_session_id
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT v_limit;
END;
$$;

COMMENT ON FUNCTION public.get_session_timeline(uuid, uuid, int)
IS 'Lazy drawer RPC: returns recent events for a session (ads-only enforced).';

REVOKE ALL ON FUNCTION public.get_session_timeline(uuid, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_session_timeline(uuid, uuid, int) TO authenticated;

COMMIT;

