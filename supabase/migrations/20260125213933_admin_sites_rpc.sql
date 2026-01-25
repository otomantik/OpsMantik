-- Migration: Admin Sites List RPC
-- Date: 2026-01-25
-- Purpose: Single-query RPC to eliminate N+1 queries in /admin/sites
-- Status logic: "RECEIVING" if last_event_at within 10 minutes, else "NO_TRAFFIC"

CREATE OR REPLACE FUNCTION public.admin_sites_list(
    search text DEFAULT NULL,
    limit_count int DEFAULT 50,
    offset_count int DEFAULT 0
)
RETURNS TABLE (
    site_id uuid,
    name text,
    domain text,
    public_id text,
    owner_user_id uuid,
    owner_email text,
    last_event_at timestamptz,
    last_category text,
    last_label text,
    minutes_ago int,
    status text
) 
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    current_month_date date;
    prev_month_date date;
BEGIN
    -- Security: Only admins can call this function
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p 
        WHERE p.id = auth.uid() AND p.role = 'admin'
    ) THEN
        RAISE EXCEPTION 'not_admin' USING MESSAGE = 'Only admins can call this function';
    END IF;

    -- Calculate month boundaries for partition queries
    current_month_date := DATE_TRUNC('month', CURRENT_DATE);
    prev_month_date := current_month_date - INTERVAL '1 month';

    -- Single query strategy:
    -- 1. Get all sites (with optional search filter)
    -- 2. UNION events from current and previous month partitions
    -- 3. Use DISTINCT ON to get latest event per site
    -- 4. Calculate status based on 10-minute threshold
    RETURN QUERY
    WITH site_base AS (
        SELECT 
            s.id,
            s.name,
            s.domain,
            s.public_id,
            s.user_id,
            s.created_at
        FROM public.sites s
        WHERE (search IS NULL OR search = '' OR 
               s.name ILIKE '%' || search || '%' OR
               s.domain ILIKE '%' || search || '%' OR
               s.public_id ILIKE '%' || search || '%')
        ORDER BY s.created_at DESC
        LIMIT limit_count
        OFFSET offset_count
    ),
    all_events AS (
        -- Get events from current month partition
        SELECT 
            s.id as site_id,
            e.created_at as event_created_at,
            e.event_category,
            e.event_label
        FROM site_base s
        INNER JOIN public.sessions sess ON sess.site_id = s.id 
            AND sess.created_month = current_month_date
        INNER JOIN public.events e ON e.session_id = sess.id 
            AND e.session_month = current_month_date
        
        UNION ALL
        
        -- Get events from previous month partition
        SELECT 
            s.id as site_id,
            e.created_at as event_created_at,
            e.event_category,
            e.event_label
        FROM site_base s
        INNER JOIN public.sessions sess ON sess.site_id = s.id 
            AND sess.created_month = prev_month_date
        INNER JOIN public.events e ON e.session_id = sess.id 
            AND e.session_month = prev_month_date
    ),
    latest_events AS (
        -- Get most recent event per site
        SELECT DISTINCT ON (site_id)
            site_id,
            event_created_at,
            event_category,
            event_label
        FROM all_events
        ORDER BY site_id, event_created_at DESC
    )
    SELECT 
        sb.id as site_id,
        sb.name,
        sb.domain,
        sb.public_id,
        sb.user_id as owner_user_id,
        -- Try to get email from auth.users (may be null if RLS blocks)
        (SELECT email FROM auth.users WHERE id = sb.user_id LIMIT 1) as owner_email,
        le.event_created_at as last_event_at,
        le.event_category as last_category,
        le.event_label as last_label,
        CASE 
            WHEN le.event_created_at IS NOT NULL THEN
                EXTRACT(EPOCH FROM (NOW() - le.event_created_at)) / 60::int
            ELSE NULL
        END as minutes_ago,
        CASE
            WHEN le.event_created_at IS NOT NULL AND 
                 EXTRACT(EPOCH FROM (NOW() - le.event_created_at)) / 60 <= 10 THEN
                'RECEIVING'
            ELSE
                'NO_TRAFFIC'
        END as status
    FROM site_base sb
    LEFT JOIN latest_events le ON le.site_id = sb.id
    ORDER BY sb.created_at DESC;
END;
$$;

-- Grant execute to authenticated users (RLS in function will enforce admin-only)
GRANT EXECUTE ON FUNCTION public.admin_sites_list TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.admin_sites_list IS 'Admin-only RPC to list all sites with status. Returns RECEIVING if last event within 10 minutes, else NO_TRAFFIC. Single query eliminates N+1.';
