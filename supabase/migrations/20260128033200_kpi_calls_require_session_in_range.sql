-- Migration: ADS Command Center - KPI calls require matched Ads session in range
-- Date: 2026-01-28
--
-- Rule alignment:
-- - High Intent / Sealed are counted only when call is matched to an Ads session
--   that is within the same reporting range (p_date_from..p_date_to).

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
  v_sealed int;
  v_total_events int;
  v_last_event_at timestamptz;
  v_last_call_at timestamptz;
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';

  SELECT COUNT(*)::int INTO v_ads_sessions
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_month >= v_start_month
    AND s.created_month < v_end_month
    AND s.created_at >= p_date_from
    AND s.created_at <= p_date_to
    AND (p_ads_only = false OR public.is_ads_session(s));

  SELECT COUNT(*)::int INTO v_high_intent
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at <= p_date_to
    AND c.source = 'click'
    AND (c.status = 'intent' OR c.status IS NULL)
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
          AND s.created_at <= p_date_to
          AND public.is_ads_session(s)
      )
    );

  SELECT COUNT(*)::int INTO v_sealed
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at <= p_date_to
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
          AND s.created_at <= p_date_to
          AND public.is_ads_session(s)
      )
    );

  SELECT COUNT(*)::int, MAX(e.created_at)
  INTO v_total_events, v_last_event_at
  FROM public.events e
  JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
  WHERE s.site_id = p_site_id
    AND e.session_month >= v_start_month
    AND e.session_month < v_end_month
    AND e.created_at >= p_date_from
    AND e.created_at <= p_date_to
    AND e.event_category != 'heartbeat'
    AND (p_ads_only = false OR public.is_ads_session(s));

  SELECT MAX(c.created_at) INTO v_last_call_at
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at <= p_date_to
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
          AND s.created_at <= p_date_to
          AND public.is_ads_session(s)
      )
    );

  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'date_from', p_date_from,
    'date_to', p_date_to,
    'ads_only', p_ads_only,

    'ads_sessions', v_ads_sessions,
    'high_intent', v_high_intent,
    'sealed', v_sealed,
    'cvr', CASE WHEN v_ads_sessions > 0 THEN ROUND((v_sealed::numeric / v_ads_sessions::numeric), 4) ELSE 0 END,

    -- Backward-compat
    'total_sessions', v_ads_sessions,
    'total_calls', v_high_intent,
    'confirmed_calls', v_sealed,
    'conversion_rate', CASE WHEN v_ads_sessions > 0 THEN ROUND((v_sealed::numeric / v_ads_sessions::numeric), 4) ELSE 0 END,
    'total_events', COALESCE(v_total_events, 0),
    'unique_visitors', 0,
    'last_event_at', v_last_event_at,
    'last_call_at', v_last_call_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, timestamptz, timestamptz, boolean) TO anon, authenticated, service_role;

COMMIT;

