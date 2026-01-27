-- Migration: PRO Dashboard Migration v2.2 - RPC Contract Set
-- Date: 2026-01-28
-- Purpose: Phase 1 - Complete RPC contract with date_from/date_to, Phase 4 - Breakdown RPC
-- 
-- Hard Rules:
-- - All RPCs require date_from/date_to (timestamptz)
-- - Max 6 months range enforced
-- - All queries scoped by site_id
-- - Heartbeat events excluded (event_category != 'heartbeat')
-- - No client-side aggregation

-- ============================================
-- Helper: Validate date range (max 6 months)
-- ============================================
CREATE OR REPLACE FUNCTION public.validate_date_range(
  p_date_from timestamptz,
  p_date_to timestamptz
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_range_days int;
  v_max_days int := 180; -- 6 months
BEGIN
  -- Validate dates
  IF p_date_from IS NULL OR p_date_to IS NULL THEN
    RAISE EXCEPTION 'date_from and date_to are required';
  END IF;
  
  IF p_date_from > p_date_to THEN
    RAISE EXCEPTION 'date_from must be <= date_to';
  END IF;
  
  -- Check max range
  v_range_days := EXTRACT(EPOCH FROM (p_date_to - p_date_from)) / 86400;
  
  IF v_range_days > v_max_days THEN
    RAISE EXCEPTION 'Date range exceeds maximum of % days (6 months)', v_max_days;
  END IF;
END;
$$;

-- ============================================
-- Migrate: get_dashboard_stats (v2.2 contract)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_dashboard_stats(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_result jsonb;
BEGIN
  -- Validate date range
  PERFORM validate_date_range(p_date_from, p_date_to);
  
  -- Calculate month boundaries for partition filtering
  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';
  
  WITH stats AS (
    SELECT
      (SELECT COUNT(*)::int 
       FROM public.calls 
       WHERE site_id = p_site_id 
         AND created_at >= p_date_from 
         AND created_at <= p_date_to) as total_calls,
      (SELECT COUNT(*)::int 
       FROM public.calls 
       WHERE site_id = p_site_id 
         AND status = 'confirmed' 
         AND created_at >= p_date_from 
         AND created_at <= p_date_to) as confirmed_calls,
      (SELECT MAX(created_at) 
       FROM public.calls 
       WHERE site_id = p_site_id 
         AND created_at >= p_date_from 
         AND created_at <= p_date_to) as last_call_at,
      (SELECT COUNT(*)::int 
       FROM public.sessions 
       WHERE site_id = p_site_id 
         AND created_month >= v_start_month 
         AND created_month < v_end_month
         AND created_at >= p_date_from 
         AND created_at <= p_date_to) as total_sessions,
      (SELECT COUNT(DISTINCT fingerprint)::int 
       FROM public.sessions 
       WHERE site_id = p_site_id 
         AND created_month >= v_start_month 
         AND created_month < v_end_month
         AND created_at >= p_date_from 
         AND created_at <= p_date_to) as unique_visitors,
      (SELECT COUNT(*)::int 
       FROM public.events e
       JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
       WHERE s.site_id = p_site_id 
         AND e.session_month >= v_start_month 
         AND e.session_month < v_end_month
         AND e.created_at >= p_date_from 
         AND e.created_at <= p_date_to
         AND e.event_category != 'heartbeat') as total_events,
      (SELECT MAX(e.created_at)
       FROM public.events e
       JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
       WHERE s.site_id = p_site_id 
         AND e.session_month >= v_start_month 
         AND e.session_month < v_end_month
         AND e.created_at >= p_date_from 
         AND e.created_at <= p_date_to
         AND e.event_category != 'heartbeat') as last_event_at
  )
  SELECT jsonb_build_object(
    'site_id', p_site_id,
    'date_from', p_date_from,
    'date_to', p_date_to,
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

-- ============================================
-- RPC: get_dashboard_timeline (Phase 1)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_dashboard_timeline(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_granularity text DEFAULT 'auto'
)
RETURNS jsonb[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_range_days int;
  v_effective_granularity text;
  v_result jsonb[];
BEGIN
  -- Validate date range
  PERFORM validate_date_range(p_date_from, p_date_to);
  
  -- Calculate month boundaries
  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';
  
  -- Determine granularity
  v_range_days := EXTRACT(EPOCH FROM (p_date_to - p_date_from)) / 86400;
  
  IF p_granularity = 'auto' THEN
    IF v_range_days <= 7 THEN
      v_effective_granularity := 'hour';
    ELSIF v_range_days <= 30 THEN
      v_effective_granularity := 'day';
    ELSE
      v_effective_granularity := 'week';
    END IF;
  ELSE
    v_effective_granularity := p_granularity;
  END IF;
  
  -- Aggregate by time bucket (separate aggregations for efficiency)
  WITH time_buckets AS (
    SELECT
      bucket_time,
      COALESCE(SUM(visitors), 0) as visitors,
      COALESCE(SUM(events), 0) as events,
      COALESCE(SUM(calls), 0) as calls,
      COALESCE(SUM(intents), 0) as intents,
      COALESCE(SUM(conversions), 0) as conversions
    FROM (
      -- Sessions (visitors by fingerprint)
      SELECT
        CASE v_effective_granularity
          WHEN 'hour' THEN DATE_TRUNC('hour', created_at)
          WHEN 'day' THEN DATE_TRUNC('day', created_at)
          WHEN 'week' THEN DATE_TRUNC('week', created_at)
          ELSE DATE_TRUNC('day', created_at)
        END as bucket_time,
        COUNT(DISTINCT fingerprint) as visitors,
        0::bigint as events,
        0::bigint as calls,
        0::bigint as intents,
        0::bigint as conversions
      FROM public.sessions
      WHERE site_id = p_site_id
        AND created_month >= v_start_month
        AND created_month < v_end_month
        AND created_at >= p_date_from
        AND created_at <= p_date_to
      GROUP BY bucket_time
      
      UNION ALL
      
      -- Events (exclude heartbeats)
      SELECT
        CASE v_effective_granularity
          WHEN 'hour' THEN DATE_TRUNC('hour', e.created_at)
          WHEN 'day' THEN DATE_TRUNC('day', e.created_at)
          WHEN 'week' THEN DATE_TRUNC('week', e.created_at)
          ELSE DATE_TRUNC('day', e.created_at)
        END as bucket_time,
        0::bigint as visitors,
        COUNT(*) as events,
        0::bigint as calls,
        0::bigint as intents,
        COUNT(*) FILTER (WHERE e.event_category = 'conversion') as conversions
      FROM public.events e
      JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
      WHERE s.site_id = p_site_id
        AND e.session_month >= v_start_month
        AND e.session_month < v_end_month
        AND e.created_at >= p_date_from
        AND e.created_at <= p_date_to
        AND e.event_category != 'heartbeat'
      GROUP BY bucket_time
      
      UNION ALL
      
      -- Calls
      SELECT
        CASE v_effective_granularity
          WHEN 'hour' THEN DATE_TRUNC('hour', created_at)
          WHEN 'day' THEN DATE_TRUNC('day', created_at)
          WHEN 'week' THEN DATE_TRUNC('week', created_at)
          ELSE DATE_TRUNC('day', created_at)
        END as bucket_time,
        0::bigint as visitors,
        0::bigint as events,
        COUNT(*) as calls,
        COUNT(*) FILTER (WHERE status = 'intent') as intents,
        COUNT(*) FILTER (WHERE status IN ('confirmed', 'qualified', 'real')) as conversions
      FROM public.calls
      WHERE site_id = p_site_id
        AND created_at >= p_date_from
        AND created_at <= p_date_to
      GROUP BY bucket_time
    ) combined
    GROUP BY bucket_time
    ORDER BY bucket_time
  )
  SELECT COALESCE(
    array_agg(
      jsonb_build_object(
        'date', bucket_time::text,
        'label', CASE v_effective_granularity
          WHEN 'hour' THEN TO_CHAR(bucket_time, 'HH24:MI')
          WHEN 'day' THEN TO_CHAR(bucket_time, 'DD/MM')
          WHEN 'week' THEN TO_CHAR(bucket_time, 'DD/MM')
          ELSE TO_CHAR(bucket_time, 'DD/MM')
        END,
        'visitors', COALESCE(visitors, 0),
        'events', COALESCE(events, 0),
        'calls', COALESCE(calls, 0),
        'intents', COALESCE(intents, 0),
        'conversions', COALESCE(conversions, 0)
      )
      ORDER BY bucket_time
    ),
    ARRAY[]::jsonb[]
  ) INTO v_result
  FROM time_buckets;
  
  RETURN COALESCE(v_result, ARRAY[]::jsonb[]);
END;
$$;

-- ============================================
-- RPC: get_dashboard_intents (Phase 1)
-- ============================================
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
      c.id,
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

-- ============================================
-- RPC: get_dashboard_breakdown (Phase 4)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_dashboard_breakdown(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_dimension text -- 'source' | 'device' | 'city'
)
RETURNS jsonb[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_total_count bigint;
  v_result jsonb[];
BEGIN
  -- Validate date range
  PERFORM validate_date_range(p_date_from, p_date_to);
  
  -- Validate dimension
  IF p_dimension NOT IN ('source', 'device', 'city') THEN
    RAISE EXCEPTION 'Invalid dimension: %. Must be source, device, or city', p_dimension;
  END IF;
  
  -- Calculate month boundaries
  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';
  
  -- Get total count for percentage calculation
  SELECT COUNT(*) INTO v_total_count
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_month >= v_start_month
    AND s.created_month < v_end_month
    AND s.created_at >= p_date_from
    AND s.created_at <= p_date_to;
  
  -- Aggregate by dimension
  CASE p_dimension
    WHEN 'source' THEN
      SELECT array_agg(
        jsonb_build_object(
          'dimension_value', COALESCE(attribution_source, 'Unknown'),
          'count', count,
          'percentage', CASE WHEN v_total_count > 0 THEN ROUND((count::numeric / v_total_count::numeric) * 100, 2) ELSE 0 END
        )
        ORDER BY count DESC
      ) INTO v_result
      FROM (
        SELECT attribution_source, COUNT(*) as count
        FROM public.sessions
        WHERE site_id = p_site_id
          AND created_month >= v_start_month
          AND created_month < v_end_month
          AND created_at >= p_date_from
          AND created_at <= p_date_to
        GROUP BY attribution_source
      ) breakdown;
    
    WHEN 'device' THEN
      SELECT array_agg(
        jsonb_build_object(
          'dimension_value', COALESCE(device_type, 'Unknown'),
          'count', count,
          'percentage', CASE WHEN v_total_count > 0 THEN ROUND((count::numeric / v_total_count::numeric) * 100, 2) ELSE 0 END
        )
        ORDER BY count DESC
      ) INTO v_result
      FROM (
        SELECT device_type, COUNT(*) as count
        FROM public.sessions
        WHERE site_id = p_site_id
          AND created_month >= v_start_month
          AND created_month < v_end_month
          AND created_at >= p_date_from
          AND created_at <= p_date_to
        GROUP BY device_type
      ) breakdown;
    
    WHEN 'city' THEN
      SELECT array_agg(
        jsonb_build_object(
          'dimension_value', COALESCE(city, 'Unknown'),
          'count', count,
          'percentage', CASE WHEN v_total_count > 0 THEN ROUND((count::numeric / v_total_count::numeric) * 100, 2) ELSE 0 END
        )
        ORDER BY count DESC
      ) INTO v_result
      FROM (
        SELECT city, COUNT(*) as count
        FROM public.sessions
        WHERE site_id = p_site_id
          AND created_month >= v_start_month
          AND created_month < v_end_month
          AND created_at >= p_date_from
          AND created_at <= p_date_to
        GROUP BY city
      ) breakdown;
  END CASE;
  
  RETURN COALESCE(v_result, ARRAY[]::jsonb[]);
END;
$$;

-- ============================================
-- Grants
-- ============================================
GRANT EXECUTE ON FUNCTION public.validate_date_range(timestamptz, timestamptz) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, timestamptz, timestamptz) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_dashboard_timeline(uuid, timestamptz, timestamptz, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_dashboard_intents(uuid, timestamptz, timestamptz, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_dashboard_breakdown(uuid, timestamptz, timestamptz, text) TO anon, authenticated, service_role;
