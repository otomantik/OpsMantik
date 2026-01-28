-- Migration: Phase C2 - KPI breakdown (phone/whatsapp/forms) + half-open ranges
-- Date: 2026-01-28
--
-- Adds fields to get_dashboard_stats JSON payload:
-- - phone_click_intents
-- - whatsapp_click_intents
-- - forms (conversion form_submit in-range)
-- - forms_enabled (heuristic: any form_submit in last 365d, ads-only aware)
--
-- Also aligns all range filters to half-open intervals: [p_date_from, p_date_to)
BEGIN;

CREATE OR REPLACE FUNCTION public.get_dashboard_stats(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_ads_only boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start_month date;
  v_end_month date;

  v_ads_sessions int;
  v_high_intent int;
  v_phone_click_intents int;
  v_whatsapp_click_intents int;
  v_sealed int;

  v_total_events int;
  v_forms int;
  v_forms_enabled boolean;
  v_last_event_at timestamptz;
  v_last_call_at timestamptz;

  v_forms_window_from timestamptz;
  v_forms_start_month date;
  v_forms_end_month date;
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';

  -- Ads sessions in-range (half-open)
  SELECT COUNT(*)::int INTO v_ads_sessions
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_month >= v_start_month
    AND s.created_month < v_end_month
    AND s.created_at >= p_date_from
    AND s.created_at < p_date_to
    AND (p_ads_only = false OR public.is_ads_session(s));

  -- Click intents breakdown (phone/whatsapp) + legacy high_intent (phone+whatsapp)
  SELECT
    COUNT(*) FILTER (WHERE c.source = 'click' AND (c.status = 'intent' OR c.status IS NULL))::int,
    COUNT(*) FILTER (WHERE c.source = 'click' AND (c.status = 'intent' OR c.status IS NULL) AND c.intent_action = 'phone')::int,
    COUNT(*) FILTER (WHERE c.source = 'click' AND (c.status = 'intent' OR c.status IS NULL) AND c.intent_action = 'whatsapp')::int
  INTO v_high_intent, v_phone_click_intents, v_whatsapp_click_intents
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.site_id = p_site_id
          AND s.id = c.matched_session_id
          AND s.created_month >= v_start_month
          AND s.created_month < v_end_month
          AND s.created_at >= p_date_from
          AND s.created_at < p_date_to
          AND public.is_ads_session(s)
      )
    );

  -- Sealed calls (half-open)
  SELECT COUNT(*)::int INTO v_sealed
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND c.status IN ('confirmed', 'qualified', 'real')
    AND (
      p_ads_only = false
      OR EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.site_id = p_site_id
          AND s.id = c.matched_session_id
          AND s.created_month >= v_start_month
          AND s.created_month < v_end_month
          AND s.created_at >= p_date_from
          AND s.created_at < p_date_to
          AND public.is_ads_session(s)
      )
    );

  -- Events total + last + forms (form_submit) within range (half-open)
  SELECT
    COUNT(*)::int,
    MAX(e.created_at),
    COUNT(*) FILTER (WHERE e.event_category = 'conversion' AND e.event_action = 'form_submit')::int
  INTO v_total_events, v_last_event_at, v_forms
  FROM public.events e
  JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
  WHERE s.site_id = p_site_id
    AND e.session_month >= v_start_month
    AND e.session_month < v_end_month
    AND e.created_at >= p_date_from
    AND e.created_at < p_date_to
    AND e.event_category != 'heartbeat'
    AND (p_ads_only = false OR public.is_ads_session(s));

  -- Last call in-range (half-open)
  SELECT MAX(c.created_at) INTO v_last_call_at
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.site_id = p_site_id
          AND s.id = c.matched_session_id
          AND s.created_month >= v_start_month
          AND s.created_month < v_end_month
          AND s.created_at >= p_date_from
          AND s.created_at < p_date_to
          AND public.is_ads_session(s)
      )
    );

  -- Forms enabled heuristic (site capability): any form_submit in last 365 days (bounded by partitions)
  v_forms_window_from := p_date_to - INTERVAL '365 days';
  v_forms_start_month := DATE_TRUNC('month', v_forms_window_from)::date;
  v_forms_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';

  SELECT EXISTS(
    SELECT 1
    FROM public.events e
    JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
    WHERE s.site_id = p_site_id
      AND e.session_month >= v_forms_start_month
      AND e.session_month < v_forms_end_month
      AND e.created_at >= v_forms_window_from
      AND e.created_at < p_date_to
      AND e.event_category = 'conversion'
      AND e.event_action = 'form_submit'
      AND (p_ads_only = false OR public.is_ads_session(s))
    LIMIT 1
  ) INTO v_forms_enabled;

  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'date_from', p_date_from,
    'date_to', p_date_to,
    'ads_only', p_ads_only,

    'ads_sessions', COALESCE(v_ads_sessions, 0),
    'high_intent', COALESCE(v_high_intent, 0),
    'phone_click_intents', COALESCE(v_phone_click_intents, 0),
    'whatsapp_click_intents', COALESCE(v_whatsapp_click_intents, 0),
    'forms', COALESCE(v_forms, 0),
    'forms_enabled', COALESCE(v_forms_enabled, false),
    'sealed', COALESCE(v_sealed, 0),
    'cvr', CASE WHEN COALESCE(v_ads_sessions, 0) > 0 THEN ROUND((v_sealed::numeric / v_ads_sessions::numeric), 4) ELSE 0 END,

    -- Backward-compat
    'total_sessions', COALESCE(v_ads_sessions, 0),
    'total_calls', COALESCE(v_high_intent, 0),
    'confirmed_calls', COALESCE(v_sealed, 0),
    'conversion_rate', CASE WHEN COALESCE(v_ads_sessions, 0) > 0 THEN ROUND((v_sealed::numeric / v_ads_sessions::numeric), 4) ELSE 0 END,
    'total_events', COALESCE(v_total_events, 0),
    'unique_visitors', 0,
    'last_event_at', v_last_event_at,
    'last_call_at', v_last_call_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, timestamptz, timestamptz, boolean) TO anon, authenticated, service_role;

COMMIT;

