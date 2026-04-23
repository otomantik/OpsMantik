BEGIN;

CREATE OR REPLACE FUNCTION public._can_access_site(p_site_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN true;
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = v_uid
      AND lower(coalesce(p.role, '')) IN ('admin', 'super_admin', 'superadmin')
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sites s
    WHERE s.id = p_site_id
      AND s.user_id = v_uid
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.site_memberships sm
    WHERE sm.site_id = p_site_id
      AND sm.user_id = v_uid
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_ads_session_input(
  gclid text DEFAULT NULL,
  wbraid text DEFAULT NULL,
  gbraid text DEFAULT NULL,
  attribution_source text DEFAULT NULL,
  utm_source text DEFAULT NULL,
  utm_medium text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    (
      nullif(trim(gclid), '') IS NOT NULL
      OR nullif(trim(wbraid), '') IS NOT NULL
      OR nullif(trim(gbraid), '') IS NOT NULL
      OR lower(coalesce(attribution_source, '')) ~ '(ads|google|gads|adwords)'
      OR lower(coalesce(utm_medium, '')) IN ('cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'ads')
      OR lower(coalesce(utm_source, '')) IN ('google', 'google_ads', 'adwords')
    );
$$;

CREATE OR REPLACE FUNCTION public.is_ads_session(p_session public.sessions)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.is_ads_session_input(
    p_session.gclid,
    p_session.wbraid,
    p_session.gbraid,
    p_session.attribution_source,
    p_session.utm_source,
    p_session.utm_medium
  );
$$;

-- RPC compatibility overload
CREATE OR REPLACE FUNCTION public.is_ads_session()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT false;
$$;

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
  device_os text,
  attribution_source text,
  gclid text,
  wbraid text,
  gbraid text,
  fingerprint text,
  traffic_source text,
  traffic_medium text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.site_id,
    s.created_at,
    s.created_month,
    s.city,
    s.district,
    s.device_type,
    s.device_os,
    s.attribution_source,
    s.gclid,
    s.wbraid,
    s.gbraid,
    s.fingerprint,
    s.traffic_source,
    s.traffic_medium
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.id = p_session_id
    AND public.is_ads_session(s)
    AND public._can_access_site(p_site_id);
$$;

CREATE OR REPLACE FUNCTION public.get_session_timeline(
  p_site_id uuid,
  p_session_id uuid,
  p_limit integer DEFAULT 100
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id,
    e.created_at,
    e.event_category,
    e.event_action,
    e.event_label,
    e.url,
    e.metadata
  FROM public.events e
  JOIN public.sessions s
    ON s.id = e.session_id
   AND s.site_id = e.site_id
  WHERE e.site_id = p_site_id
    AND e.session_id = p_session_id
    AND public.is_ads_session(s)
    AND public._can_access_site(p_site_id)
  ORDER BY e.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 100), 500));
$$;

CREATE OR REPLACE FUNCTION public.get_recent_intents_v1(
  p_site_id uuid,
  p_since timestamptz DEFAULT NULL,
  p_minutes_lookback integer DEFAULT 60,
  p_limit integer DEFAULT 100,
  p_ads_only boolean DEFAULT true
)
RETURNS TABLE (
  id uuid,
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

CREATE OR REPLACE FUNCTION public.get_activity_feed_v1(
  p_site_id uuid,
  p_hours_back integer DEFAULT 72,
  p_limit integer DEFAULT 100,
  p_action_types text[] DEFAULT NULL
)
RETURNS TABLE (
  id text,
  call_id uuid,
  created_at timestamptz,
  action_type text,
  actor_type text,
  actor_id uuid,
  previous_status text,
  new_status text,
  intent_action text,
  intent_target text,
  lead_score integer,
  sale_amount numeric,
  currency text,
  reason text,
  is_latest_for_call boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (c.id::text || ':status') AS id,
    c.id AS call_id,
    c.created_at,
    CASE
      WHEN lower(coalesce(c.status, '')) IN ('confirmed', 'qualified', 'real') THEN 'seal'
      WHEN lower(coalesce(c.status, '')) = 'junk' THEN 'junk'
      WHEN lower(coalesce(c.status, '')) = 'cancelled' THEN 'cancel'
      ELSE 'create'
    END AS action_type,
    'system'::text AS actor_type,
    NULL::uuid AS actor_id,
    NULL::text AS previous_status,
    c.status AS new_status,
    CASE
      WHEN coalesce(lower(c.phone_number), '') LIKE '%whatsapp%' THEN 'whatsapp'
      ELSE 'phone'
    END AS intent_action,
    c.phone_number AS intent_target,
    c.lead_score,
    NULL::numeric AS sale_amount,
    s.currency AS currency,
    c.note AS reason,
    true AS is_latest_for_call
  FROM public.calls c
  LEFT JOIN public.sites s ON s.id = c.site_id
  WHERE c.site_id = p_site_id
    AND c.created_at >= now() - make_interval(hours => GREATEST(1, coalesce(p_hours_back, 72)))
    AND public._can_access_site(p_site_id)
    AND (
      p_action_types IS NULL
      OR array_length(p_action_types, 1) IS NULL
      OR (
        CASE
          WHEN lower(coalesce(c.status, '')) IN ('confirmed', 'qualified', 'real') THEN 'seal'
          WHEN lower(coalesce(c.status, '')) = 'junk' THEN 'junk'
          WHEN lower(coalesce(c.status, '')) = 'cancelled' THEN 'cancel'
          ELSE 'create'
        END
      ) = ANY (p_action_types)
    )
  ORDER BY c.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 100), 500));
$$;

CREATE OR REPLACE FUNCTION public.get_kill_feed_v1(
  p_site_id uuid,
  p_hours_back integer DEFAULT 72,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  action_at timestamptz,
  created_at timestamptz,
  status text,
  intent_action text,
  intent_target text,
  sale_amount numeric,
  currency text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.created_at AS action_at,
    c.created_at,
    c.status,
    CASE
      WHEN coalesce(lower(c.phone_number), '') LIKE '%whatsapp%' THEN 'whatsapp'
      ELSE 'phone'
    END AS intent_action,
    c.phone_number AS intent_target,
    NULL::numeric AS sale_amount,
    s.currency
  FROM public.calls c
  LEFT JOIN public.sites s ON s.id = c.site_id
  WHERE c.site_id = p_site_id
    AND c.created_at >= now() - make_interval(hours => GREATEST(1, coalesce(p_hours_back, 72)))
    AND lower(coalesce(c.status, '')) IN ('confirmed', 'qualified', 'real', 'junk', 'cancelled')
    AND public._can_access_site(p_site_id)
  ORDER BY c.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 100), 500));
$$;

CREATE OR REPLACE FUNCTION public.undo_last_action_v1(
  p_call_id uuid,
  p_actor_type text DEFAULT 'user',
  p_actor_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_id uuid;
  v_status text;
  v_updated integer := 0;
BEGIN
  SELECT c.site_id, c.status
  INTO v_site_id, v_status
  FROM public.calls c
  WHERE c.id = p_call_id
  LIMIT 1;

  IF v_site_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public._can_access_site(v_site_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  IF lower(coalesce(v_status, '')) IN ('junk', 'cancelled', 'confirmed', 'qualified', 'real') THEN
    UPDATE public.calls
    SET
      status = 'intent',
      confirmed_at = NULL,
      confirmed_by = NULL
    WHERE id = p_call_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.ping()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT true;
$$;

CREATE OR REPLACE FUNCTION public.ops_db_now_v1()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT now();
$$;

CREATE OR REPLACE FUNCTION public.verify_partition_triggers_exist()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sessions_set_created_month' AND NOT tgisinternal)
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'events_set_session_month_from_session' AND NOT tgisinternal);
$$;

CREATE OR REPLACE FUNCTION public.create_next_month_partitions()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'ok', true,
    'noop', true,
    'note', 'Baseline runtime uses non-partitioned core tables.'
  );
$$;

CREATE OR REPLACE FUNCTION public.watchtower_partition_drift_check_v1()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'ok', public.verify_partition_triggers_exist(),
    'trigger_sessions_set_created_month', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sessions_set_created_month' AND NOT tgisinternal),
    'trigger_events_set_session_month_from_session', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'events_set_session_month_from_session' AND NOT tgisinternal),
    'checked_at', now()
  );
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_merkle_1000()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'heartbeat', false,
    'note', 'causal_dna_ledger not enabled on this runtime baseline',
    'checked_at', now()
  );
$$;

CREATE OR REPLACE FUNCTION public.ai_pipeline_gate_checks()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ext AS (
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') AS pg_net_enabled
  ), trig AS (
    SELECT EXISTS (
      SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'calls'
        AND NOT t.tgisinternal
    ) AS trigger_exists
  ), keys AS (
    SELECT (to_regclass('public.api_keys') IS NOT NULL) AS api_keys_configured
  )
  SELECT jsonb_build_object(
    'pg_net_enabled', ext.pg_net_enabled,
    'trigger_exists', trig.trigger_exists,
    'api_keys_configured', keys.api_keys_configured
  )
  FROM ext, trig, keys;
$$;

GRANT EXECUTE ON FUNCTION public._can_access_site(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_ads_session_input(text, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_ads_session(public.sessions) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_ads_session() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_session_details(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_session_timeline(uuid, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_v1(uuid, timestamptz, integer, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_v2(uuid, timestamptz, timestamptz, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_dashboard_intents(uuid, timestamptz, timestamptz, text, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_intent_details_v1(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_activity_feed_v1(uuid, integer, integer, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kill_feed_v1(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.undo_last_action_v1(uuid, text, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ping() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_db_now_v1() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_partition_triggers_exist() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_next_month_partitions() TO service_role;
GRANT EXECUTE ON FUNCTION public.watchtower_partition_drift_check_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_merkle_1000() TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_pipeline_gate_checks() TO service_role;

COMMIT;
