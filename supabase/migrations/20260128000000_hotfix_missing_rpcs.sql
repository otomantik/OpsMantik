-- HOTFIX: Missing RPC Functions (get_recent_intents_v1, get_session_details, get_session_timeline)
-- Date: 2026-01-28
-- 
-- This script adds all missing columns and functions required for Live Inbox
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/jktpvfbmuoqrtuwbjpwl/sql

BEGIN;

-- =====================================================
-- STEP 1: Add missing columns to calls table
-- =====================================================

-- Add intent_stamp, intent_action, intent_target columns
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS intent_stamp TEXT,
  ADD COLUMN IF NOT EXISTS intent_action TEXT,
  ADD COLUMN IF NOT EXISTS intent_target TEXT;

COMMENT ON COLUMN public.calls.intent_stamp IS 'Client-generated idempotency stamp for click intents (nullable).';
COMMENT ON COLUMN public.calls.intent_action IS 'Normalized intent action (e.g. phone_call, whatsapp_click) (nullable).';
COMMENT ON COLUMN public.calls.intent_target IS 'Normalized target for dedupe (e.g. +905.. or wa.me/..) (nullable).';

-- Add intent_page_url and click_id columns
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS intent_page_url TEXT,
  ADD COLUMN IF NOT EXISTS click_id TEXT;

COMMENT ON COLUMN public.calls.intent_page_url IS 'Page URL where the click intent occurred (no joins needed).';
COMMENT ON COLUMN public.calls.click_id IS 'Best-effort click id (gclid/wbraid/gbraid) captured at intent time (nullable).';

-- Add indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_site_intent_stamp_uniq
ON public.calls(site_id, intent_stamp)
WHERE intent_stamp IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calls_intent_fallback_dedupe
ON public.calls(site_id, matched_session_id, intent_action, intent_target, created_at)
WHERE source = 'click' AND (status = 'intent' OR status IS NULL);

CREATE INDEX IF NOT EXISTS idx_calls_site_source_created_at
ON public.calls(site_id, source, created_at DESC);

-- =====================================================
-- STEP 2: Add sessions.lead_score column if missing
-- =====================================================

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0;

COMMENT ON COLUMN public.sessions.lead_score IS 'Calculated lead score for the session';

-- =====================================================
-- STEP 3: Update is_admin helper function
-- =====================================================

CREATE OR REPLACE FUNCTION public.is_admin(check_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = check_user_id AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.is_admin(UUID) IS 'Check if user is admin by user_id';

-- =====================================================
-- STEP 4: Create is_ads_session helper functions
-- =====================================================

-- Drop old version if exists
DROP FUNCTION IF EXISTS public.is_ads_session_input(text, text, text, text, text, text);

-- Create is_ads_session_input function
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

-- Create composite wrapper
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

COMMENT ON FUNCTION public.is_ads_session(public.sessions)
IS 'Ads-origin classifier for sessions row. Delegates to is_ads_session_input().';

-- Grant permissions
REVOKE ALL ON FUNCTION public.is_ads_session_input(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ads_session_input(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ads_session_input(text, text, text, text, text, text) TO service_role;

-- =====================================================
-- STEP 5: Create get_session_details RPC
-- =====================================================

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
  v_role text;
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
    AND public.is_ads_session(sess)
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.get_session_details(uuid, uuid)
IS 'Get session details for a specific session (ads-only enforced).';

REVOKE ALL ON FUNCTION public.get_session_details(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_session_details(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_details(uuid, uuid) TO service_role;

-- =====================================================
-- STEP 6: Create get_session_timeline RPC
-- =====================================================

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

  -- Ensure session belongs to site and is ads-only
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
GRANT EXECUTE ON FUNCTION public.get_session_timeline(uuid, uuid, int) TO service_role;

-- =====================================================
-- STEP 7: Create get_recent_intents_v1 RPC
-- =====================================================

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
      FROM public.sites s0
      WHERE s0.id = p_site_id
        AND (
          s0.user_id = v_user_id
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s0.id AND sm.user_id = v_user_id
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
          'intent_page_url', COALESCE(c.intent_page_url, s.entry_page),
          'matched_session_id', c.matched_session_id,
          'lead_score', c.lead_score,
          'status', c.status,
          'click_id', COALESCE(c.click_id, s.gclid, s.wbraid, s.gbraid),
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
GRANT EXECUTE ON FUNCTION public.get_recent_intents_v1(uuid, timestamptz, int, int, boolean) TO service_role;

COMMIT;

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================
-- Run these after the migration to verify everything works:
-- 
-- 1. Check if columns exist:
-- SELECT column_name FROM information_schema.columns 
-- WHERE table_name = 'calls' AND column_name IN ('intent_stamp', 'intent_action', 'intent_target', 'intent_page_url', 'click_id');
-- 
-- 2. Check if functions exist:
-- SELECT routine_name FROM information_schema.routines 
-- WHERE routine_schema = 'public' AND routine_name IN ('get_recent_intents_v1', 'get_session_details', 'get_session_timeline', 'is_ads_session');
-- 
-- 3. Test get_recent_intents_v1 (replace <your-site-id> with actual site_id):
-- SELECT * FROM get_recent_intents_v1('<your-site-id>'::uuid, null, 60, 10, true);
--
-- ✅ After running this script, your Live Inbox should work!
