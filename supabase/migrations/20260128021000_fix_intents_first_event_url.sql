-- Migration: Fix get_dashboard_intents - Remove first_event_url reference
-- Date: 2026-01-28
-- Purpose: Fix get_dashboard_intents to use subquery for first event URL instead of non-existent column

CREATE OR REPLACE FUNCTION public.get_dashboard_intents(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS jsonb[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_result jsonb[];
BEGIN
  -- Validate date range
  PERFORM validate_date_range(p_date_from, p_date_to);
  
  -- Calculate month boundaries
  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';
  
  -- Combine calls and conversion events
  WITH intents AS (
    -- Calls
    SELECT
      c.id::text as id,
      'call'::text as type,
      c.created_at as timestamp,
      c.status,
      c.confirmed_at as sealed_at,
      COALESCE(
        (SELECT e.url FROM public.events e 
         WHERE e.session_id = c.matched_session_id 
           AND e.session_month = s.created_month
         ORDER BY e.created_at ASC 
         LIMIT 1),
        ''
      ) as page_url,
      s.city,
      s.district,
      s.device_type,
      c.matched_session_id,
      COALESCE(c.lead_score, 0) as confidence_score,
      c.phone_number,
      NULL::text as event_category,
      NULL::text as event_action
    FROM public.calls c
    LEFT JOIN public.sessions s ON c.matched_session_id = s.id AND s.created_month >= v_start_month AND s.created_month < v_end_month
    WHERE c.site_id = p_site_id
      AND c.created_at >= p_date_from
      AND c.created_at <= p_date_to
      AND (p_status IS NULL OR 
           (p_status = 'pending' AND (c.status = 'intent' OR c.status IS NULL)) OR
           (p_status = 'sealed' AND c.status IN ('confirmed', 'qualified', 'real')) OR
           c.status = p_status)
      AND (p_search IS NULL OR 
           COALESCE(
             (SELECT e.url FROM public.events e 
              WHERE e.session_id = c.matched_session_id 
                AND e.session_month = s.created_month
              ORDER BY e.created_at ASC 
              LIMIT 1),
             ''
           ) ILIKE '%' || p_search || '%')
    
    UNION ALL
    
    -- Conversion events
    SELECT
      'conv-' || e.id as id,
      'conversion'::text as type,
      e.created_at as timestamp,
      'confirmed'::text as status,
      e.created_at as sealed_at,
      COALESCE(e.url, '') as page_url,
      s.city,
      s.district,
      s.device_type,
      e.session_id as matched_session_id,
      COALESCE(e.event_value, 0) as confidence_score,
      NULL::text as phone_number,
      e.event_category,
      e.event_action
    FROM public.events e
    JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
    WHERE s.site_id = p_site_id
      AND e.event_category = 'conversion'
      AND e.session_month >= v_start_month
      AND e.session_month < v_end_month
      AND e.created_at >= p_date_from
      AND e.created_at <= p_date_to
      AND (p_status IS NULL OR p_status = 'sealed')
      AND (p_search IS NULL OR COALESCE(e.url, '') ILIKE '%' || p_search || '%')
  )
  SELECT array_agg(
    jsonb_build_object(
      'id', id,
      'type', type,
      'timestamp', timestamp,
      'status', status,
      'sealed_at', sealed_at,
      'page_url', page_url,
      'city', city,
      'district', district,
      'device_type', device_type,
      'matched_session_id', matched_session_id,
      'confidence_score', confidence_score,
      'phone_number', phone_number,
      'event_category', event_category,
      'event_action', event_action
    )
    ORDER BY timestamp DESC
  ) INTO v_result
  FROM intents;
  
  RETURN COALESCE(v_result, ARRAY[]::jsonb[]);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_intents(uuid, timestamptz, timestamptz, text, text) TO anon, authenticated, service_role;
