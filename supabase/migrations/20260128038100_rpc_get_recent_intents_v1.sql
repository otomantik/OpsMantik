-- Migration: Live Inbox v1 - get_recent_intents_v1 RPC
-- Date: 2026-01-28
--
-- Contract:
-- get_recent_intents_v1(
--   p_site_id uuid,
--   p_since timestamptz default null,
--   p_minutes_lookback int default 60,
--   p_limit int default 200,
--   p_ads_only boolean default true
-- ) returns jsonb[]
--
-- Source of truth: public.calls (source='click')
-- Minimal join: sessions only for ads-only filter + optional click ids

BEGIN;

CREATE OR REPLACE FUNCTION public.get_recent_intents_v1(
  p_site_id uuid,
  p_since timestamptz DEFAULT NULL,
  p_minutes_lookback int DEFAULT 60,
  p_limit int DEFAULT 200,
  p_ads_only boolean DEFAULT true
)
RETURNS jsonb[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_limit int;
  v_since timestamptz;
BEGIN
  v_user_id := auth.uid();
  v_role := auth.role();

  -- Auth: allow authenticated users; service_role permitted for smoke/scripts
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

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
  v_since := COALESCE(
    p_since,
    now() - make_interval(mins => GREATEST(1, LEAST(COALESCE(p_minutes_lookback, 60), 24 * 60)))
  );

  RETURN (
    SELECT COALESCE(
      ARRAY(
        SELECT jsonb_build_object(
          'id', c.id,
          'created_at', c.created_at,
          'intent_action', c.intent_action,
          'intent_target', c.intent_target,
          'intent_stamp', c.intent_stamp,
          'intent_page_url', c.intent_page_url,
          'matched_session_id', c.matched_session_id,
          'lead_score', c.lead_score,
          'status', c.status,
          'click_id', c.click_id,
          -- Optional: return ids from session if available (lightweight join)
          'gclid', s.gclid,
          'wbraid', s.wbraid,
          'gbraid', s.gbraid
        )
        FROM public.calls c
        LEFT JOIN public.sessions s
          ON s.id = c.matched_session_id
         AND s.site_id = p_site_id
        WHERE c.site_id = p_site_id
          AND c.source = 'click'
          AND (c.status IN ('intent','confirmed','junk') OR c.status IS NULL)
          AND c.created_at >= v_since
          AND (
            p_ads_only = false
            OR (
              s.id IS NOT NULL
              AND public.is_ads_session(s)
            )
          )
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT v_limit
      ),
      ARRAY[]::jsonb[]
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_recent_intents_v1(uuid, timestamptz, int, int, boolean)
IS 'Live Inbox RPC: recent click intents from calls (fast). Optional ads-only filter using minimal sessions join.';

REVOKE ALL ON FUNCTION public.get_recent_intents_v1(uuid, timestamptz, int, int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_v1(uuid, timestamptz, int, int, boolean) TO authenticated;

COMMIT;

