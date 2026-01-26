-- Migration: Standard Dashboard Stats RPC
-- Date: 2026-01-27

CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_site_id uuid, p_days int DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_start_date timestamptz;
    v_start_month date;
    v_result jsonb;
BEGIN
    v_start_date := NOW() - (p_days || ' days')::interval;
    v_start_month := DATE_TRUNC('month', v_start_date)::date;

    WITH stats AS (
        SELECT
            (SELECT COUNT(*)::int FROM public.calls WHERE site_id = p_site_id AND created_at >= v_start_date) as total_calls,
            (SELECT COUNT(*)::int FROM public.calls WHERE site_id = p_site_id AND status = 'confirmed' AND created_at >= v_start_date) as confirmed_calls,
            (SELECT MAX(created_at) FROM public.calls WHERE site_id = p_site_id) as last_call_at,
            (SELECT COUNT(*)::int FROM public.sessions WHERE site_id = p_site_id AND created_month >= v_start_month AND created_at >= v_start_date) as total_sessions,
            (SELECT COUNT(DISTINCT fingerprint)::int FROM public.sessions WHERE site_id = p_site_id AND created_month >= v_start_month AND created_at >= v_start_date) as unique_visitors,
            (SELECT COUNT(*)::int 
             FROM public.events e
             JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
             WHERE s.site_id = p_site_id 
               AND e.session_month >= v_start_month 
               AND e.created_at >= v_start_date) as total_events,
            (SELECT MAX(e.created_at)
             FROM public.events e
             JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
             WHERE s.site_id = p_site_id 
               AND e.session_month >= v_start_month) as last_event_at
    )
    SELECT jsonb_build_object(
        'site_id', p_site_id,
        'range_days', p_days,
        'total_calls', total_calls,
        'total_events', total_events,
        'total_sessions', total_sessions,
        'unique_visitors', unique_visitors,
        'confirmed_calls', confirmed_calls,
        'conversion_rate', CASE WHEN unique_visitors > 0 THEN ROUND((confirmed_calls::numeric / unique_visitors::numeric), 4) ELSE 0 END,
        'last_event_at', last_event_at,
        'last_call_at', last_call_at
    ) INTO v_result
    FROM stats;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, int) TO anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, int) TO service_role;
