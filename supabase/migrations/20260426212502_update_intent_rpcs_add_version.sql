DROP FUNCTION IF EXISTS public.get_recent_intents_v1(uuid, timestamptz, integer, integer, boolean);
DROP FUNCTION IF EXISTS public.get_recent_intents_v2(uuid, timestamptz, timestamptz, integer, boolean);
DROP FUNCTION IF EXISTS public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, integer, boolean);

CREATE OR REPLACE FUNCTION public.get_recent_intents_v1(
  p_site_id uuid,
  p_since timestamptz DEFAULT NULL,
  p_minutes_lookback integer DEFAULT 60,
  p_limit integer DEFAULT 100,
  p_ads_only boolean DEFAULT true
)
RETURNS TABLE (
  id uuid,
  version integer,
  created_at timestamptz,
  status text,
  matched_session_id uuid,
  intent_action text,
  intent_target text,
  summary text,
  page_url text,
  click_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT coalesce(p_since, now() - make_interval(mins => GREATEST(1, coalesce(p_minutes_lookback, 60)))) AS since_at
  )
  SELECT
    c.id,
    c.version,
    c.created_at,
    c.status,
    c.matched_session_id,
    CASE
      WHEN coalesce(lower(c.phone_number), '') LIKE '%whatsapp%' THEN 'whatsapp'
      ELSE 'phone'
    END AS intent_action,
    c.phone_number AS intent_target,
    c.phone_number AS summary,
    s.entry_page AS page_url,
    coalesce(s.gclid, s.wbraid, s.gbraid) AS click_id
  FROM public.calls c
  LEFT JOIN public.sessions s
    ON s.id = c.matched_session_id
   AND s.site_id = c.site_id
  CROSS JOIN bounds b
  WHERE c.site_id = p_site_id
    AND c.created_at >= b.since_at
    AND public._can_access_site(p_site_id)
    AND (NOT coalesce(p_ads_only, true) OR (s.id IS NOT NULL AND public.is_ads_session(s)))
  ORDER BY c.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 100), 500));
$$;

CREATE OR REPLACE FUNCTION public.get_recent_intents_v2(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_limit integer DEFAULT 100,
  p_ads_only boolean DEFAULT true
)
RETURNS TABLE (
  id uuid,
  version integer,
  created_at timestamptz,
  status text,
  matched_session_id uuid,
  intent_action text,
  intent_target text,
  summary text,
  page_url text,
  click_id text,
  city text,
  district text,
  device_type text,
  device_os text,
  attribution_source text,
  traffic_source text,
  traffic_medium text,
  gclid text,
  wbraid text,
  gbraid text,
  utm_term text,
  utm_campaign text,
  utm_source text,
  matchtype text,
  total_duration_sec integer,
  event_count integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.version,
    c.created_at,
    c.status,
    c.matched_session_id,
    CASE
      WHEN coalesce(lower(c.phone_number), '') LIKE '%whatsapp%' THEN 'whatsapp'
      ELSE 'phone'
    END AS intent_action,
    c.phone_number AS intent_target,
    c.phone_number AS summary,
    s.entry_page AS page_url,
    coalesce(s.gclid, s.wbraid, s.gbraid) AS click_id,
    s.city,
    s.district,
    s.device_type,
    s.device_os,
    s.attribution_source,
    s.traffic_source,
    s.traffic_medium,
    s.gclid,
    s.wbraid,
    s.gbraid,
    s.utm_term,
    s.utm_campaign,
    s.utm_source,
    s.matchtype,
    s.total_duration_sec,
    s.event_count
  FROM public.calls c
  LEFT JOIN public.sessions s
    ON s.id = c.matched_session_id
   AND s.site_id = c.site_id
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND public._can_access_site(p_site_id)
    AND (NOT coalesce(p_ads_only, true) OR (s.id IS NOT NULL AND public.is_ads_session(s)))
  ORDER BY c.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 100), 500));
$$;

-- Fail-closed queue visibility: hide sessions tainted by junk/cancelled status.
CREATE OR REPLACE FUNCTION public.get_recent_intents_lite_v1(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_limit integer DEFAULT 100,
  p_ads_only boolean DEFAULT true
)
RETURNS TABLE (
  id uuid,
  version integer,
  created_at timestamptz,
  status text,
  matched_session_id uuid,
  intent_action text,
  intent_target text,
  summary text,
  intent_page_url text,
  page_url text,
  click_id text,
  phone_clicks integer,
  whatsapp_clicks integer,
  intent_events integer,
  traffic_source text,
  traffic_medium text,
  attribution_source text,
  gclid text,
  wbraid text,
  gbraid text,
  utm_term text,
  utm_campaign text,
  utm_source text,
  matchtype text,
  city text,
  district text,
  device_type text,
  device_os text,
  total_duration_sec integer,
  event_count integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.version,
    c.created_at,
    c.status,
    c.matched_session_id,
    CASE
      WHEN coalesce(lower(c.phone_number), '') LIKE '%whatsapp%' THEN 'whatsapp'
      ELSE 'phone'
    END AS intent_action,
    c.phone_number AS intent_target,
    c.phone_number AS summary,
    s.entry_page AS intent_page_url,
    s.entry_page AS page_url,
    coalesce(s.gclid, s.wbraid, s.gbraid) AS click_id,
    0::integer AS phone_clicks,
    0::integer AS whatsapp_clicks,
    1::integer AS intent_events,
    s.traffic_source,
    s.traffic_medium,
    s.attribution_source,
    s.gclid,
    s.wbraid,
    s.gbraid,
    s.utm_term,
    s.utm_campaign,
    s.utm_source,
    s.matchtype,
    s.city,
    s.district,
    s.device_type,
    s.device_os,
    s.total_duration_sec,
    s.event_count
  FROM public.calls c
  LEFT JOIN public.sessions s
    ON s.id = c.matched_session_id
   AND s.site_id = c.site_id
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND public._can_access_site(p_site_id)
    AND (NOT coalesce(p_ads_only, true) OR (s.id IS NOT NULL AND public.is_ads_session(s)))
    AND (c.status IS NULL OR c.status = 'intent')
    AND NOT EXISTS (
      SELECT 1
      FROM public.calls c2
      WHERE c2.site_id = c.site_id
        AND c2.matched_session_id IS NOT DISTINCT FROM c.matched_session_id
        AND c2.status IN ('junk','cancelled')
    )
  ORDER BY c.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 100), 500));
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_intents(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_ads_only boolean DEFAULT true
)
RETURNS TABLE (
  id uuid,
  type text,
  "timestamp" timestamptz,
  status text,
  sealed_at timestamptz,
  page_url text,
  city text,
  district text,
  device_type text,
  matched_session_id uuid,
  confidence_score numeric,
  phone_number text,
  event_category text,
  event_action text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    'call'::text AS type,
    c.created_at AS "timestamp",
    c.status,
    c.confirmed_at AS sealed_at,
    s.entry_page AS page_url,
    s.city,
    s.district,
    s.device_type,
    c.matched_session_id,
    coalesce(c.lead_score, 0)::numeric AS confidence_score,
    c.phone_number,
    NULL::text AS event_category,
    NULL::text AS event_action
  FROM public.calls c
  LEFT JOIN public.sessions s
    ON s.id = c.matched_session_id
   AND s.site_id = c.site_id
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND public._can_access_site(p_site_id)
    AND (p_status IS NULL OR c.status = p_status)
    AND (
      p_search IS NULL
      OR coalesce(c.phone_number, '') ILIKE ('%' || p_search || '%')
      OR coalesce(s.entry_page, '') ILIKE ('%' || p_search || '%')
    )
    AND (NOT coalesce(p_ads_only, true) OR (s.id IS NOT NULL AND public.is_ads_session(s)))
  ORDER BY c.created_at DESC
  LIMIT 1000;
$$;

CREATE OR REPLACE FUNCTION public.get_intent_details_v1(
  p_site_id uuid,
  p_call_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(t)
  FROM (
    SELECT
      c.id,
      c.version,
      c.created_at,
      c.status,
      c.matched_session_id,
      CASE
        WHEN coalesce(lower(c.phone_number), '') LIKE '%whatsapp%' THEN 'whatsapp'
        ELSE 'phone'
      END AS intent_action,
      c.phone_number AS intent_target,
      s.entry_page AS intent_page_url,
      s.entry_page AS page_url,
      coalesce(s.gclid, s.wbraid, s.gbraid) AS click_id,
      s.traffic_source,
      s.traffic_medium,
      s.attribution_source,
      s.gclid,
      s.wbraid,
      s.gbraid,
      s.utm_term,
      s.utm_campaign,
      s.utm_source,
      s.matchtype,
      s.city,
      s.district,
      s.device_type,
      s.device_os,
      s.total_duration_sec,
      s.event_count
    FROM public.calls c
    LEFT JOIN public.sessions s
      ON s.id = c.matched_session_id
     AND s.site_id = c.site_id
    WHERE c.site_id = p_site_id
      AND c.id = p_call_id
      AND public._can_access_site(p_site_id)
    LIMIT 1
  ) t;
$$;
