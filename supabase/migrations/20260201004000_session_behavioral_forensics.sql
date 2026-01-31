-- Migration: Add Behavioral Forensics to sessions
-- Date: 2026-02-01

BEGIN;

-- Add behavioral tracking columns to sessions table
DO $$ 
BEGIN 
    -- Max scroll depth reached during session
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sessions' AND COLUMN_NAME = 'max_scroll_percentage') THEN
        ALTER TABLE public.sessions ADD COLUMN max_scroll_percentage integer DEFAULT 0;
    END IF;
    
    -- Count of hovers over Call-to-Action elements
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sessions' AND COLUMN_NAME = 'cta_hover_count') THEN
        ALTER TABLE public.sessions ADD COLUMN cta_hover_count integer DEFAULT 0;
    END IF;
    
    -- Total time spent focusing on input forms (in seconds)
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sessions' AND COLUMN_NAME = 'form_focus_duration') THEN
        ALTER TABLE public.sessions ADD COLUMN form_focus_duration integer DEFAULT 0;
    END IF;
    
    -- Purely active time (excluding idle/background time)
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sessions' AND COLUMN_NAME = 'total_active_seconds') THEN
        ALTER TABLE public.sessions ADD COLUMN total_active_seconds integer DEFAULT 0;
    END IF;

    -- Interaction Score (calculated based on behaviors)
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sessions' AND COLUMN_NAME = 'engagement_score') THEN
        ALTER TABLE public.sessions ADD COLUMN engagement_score integer DEFAULT 0;
    END IF;
END $$;

-- Update the get_recent_intents_v2 function to include behavioral data
CREATE OR REPLACE FUNCTION public.get_recent_intents_v2(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
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
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  v_user_id := auth.uid();
  v_role := auth.role();

  -- Auth check
  IF v_user_id IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION USING MESSAGE = 'not_authenticated', ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.sites s0 
      WHERE s0.id = p_site_id 
      AND (s0.user_id = v_user_id OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s0.id AND sm.user_id = v_user_id) OR public.is_admin(v_user_id))
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
    END IF;
  END IF;

  v_from := p_date_from;
  v_to := p_date_to;
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));

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

          -- Behavioral DNA
          'max_scroll_percentage', s.max_scroll_percentage,
          'cta_hover_count', s.cta_hover_count,
          'form_focus_duration', s.form_focus_duration,
          'total_active_seconds', s.total_active_seconds,
          'engagement_score', s.engagement_score,

          -- Budget/Financial
          'estimated_value', c.estimated_value,
          'currency', (SELECT sites.currency FROM sites WHERE sites.id = p_site_id),

          -- Session Intelligence (Hardware DNA)
          'utm_term', s.utm_term,
          'utm_campaign', s.utm_campaign,
          'utm_source', s.utm_source,
          'utm_medium', s.utm_medium,
          'matchtype', s.matchtype,
          'device_type', s.device_type,
          'device_os', s.device_os,
          'browser', s.browser,
          'browser_language', s.browser_language,
          'device_memory', s.device_memory,
          'hardware_concurrency', s.hardware_concurrency,
          'screen_width', s.screen_width,
          'screen_height', s.screen_height,
          'pixel_ratio', s.pixel_ratio,
          'gpu_renderer', s.gpu_renderer,
          'connection_type', s.connection_type,
          'is_returning', s.is_returning,
          'referrer_host', s.referrer_host,
          'ads_network', s.ads_network,
          'ads_placement', s.ads_placement,
          'attribution_source', s.attribution_source,
          'total_duration_sec', s.total_duration_sec,
          'event_count', s.event_count,
          'city', s.city,
          'district', s.district,
          'telco_carrier', s.telco_carrier,

          -- Risk Engine
          'risk_level', CASE
            WHEN (COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NULL AND COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NULL AND COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NULL AND COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NULL)
            OR (s.total_duration_sec IS NOT NULL AND s.total_duration_sec <= 3)
            THEN 'high' ELSE 'low'
          END
        )
        FROM public.calls c
        LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
        WHERE c.site_id = p_site_id
          AND c.source = 'click'
          AND (c.status IN ('intent','confirmed','junk') OR c.status IS NULL)
          AND c.created_at >= v_from
          AND c.created_at <= v_to
          AND (p_ads_only = false OR (s.id IS NOT NULL AND public.is_ads_session(s)))
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT v_limit
      ),
      ARRAY[]::jsonb[]
    )
  );
END;
$$;

COMMIT;
