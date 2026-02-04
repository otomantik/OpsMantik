-- Hunter Queue: include traffic_source / traffic_medium on intent RPCs
--
-- Motivation:
-- - Show channel badge (Google Ads / SEO / Social / Direct) directly on HunterCard
-- - Source of truth is sessions.traffic_source + sessions.traffic_medium

BEGIN;

-- -----------------------------------------------------------------------------
-- get_recent_intents_lite_v1: add traffic_source / traffic_medium (session join)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_recent_intents_lite_v1(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_limit int DEFAULT 100,
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

  -- Auth: allow authenticated users; service_role permitted for smoke/scripts
  IF v_user_id IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION USING MESSAGE = 'not_authenticated', ERRCODE = 'P0001';
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
      RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_date_from IS NULL OR p_date_to IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_range', ERRCODE = 'P0001';
  END IF;

  v_from := p_date_from;
  v_to := p_date_to;
  IF v_to < v_from THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_range', ERRCODE = 'P0001';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 100), 1000));

  RETURN (
    WITH base AS (
      SELECT
        c.id,
        c.created_at,
        c.status,
        c.matched_session_id,
        c.intent_action,
        c.intent_target,
        c.intent_phone_clicks,
        c.intent_whatsapp_clicks,
        s.traffic_source,
        s.traffic_medium
      FROM public.calls c
      LEFT JOIN public.sessions s
        ON s.id = c.matched_session_id
       AND s.site_id = p_site_id
      WHERE c.site_id = p_site_id
        AND c.source = 'click'
        AND (c.status IS NULL OR c.status = 'intent')
        AND c.created_at >= v_from
        AND c.created_at < v_to
        AND (
          p_ads_only = false
          OR (s.id IS NOT NULL AND public.is_ads_session(s))
        )
    ),
    agg AS (
      SELECT
        b.matched_session_id,
        (array_agg(b.id ORDER BY b.created_at DESC, b.id DESC))[1] AS id,
        MAX(b.created_at) AS created_at,
        COALESCE(MAX(b.status), 'intent') AS status,
        (array_agg(b.intent_action ORDER BY b.created_at DESC, b.id DESC))[1] AS intent_action,
        (array_agg(b.intent_target ORDER BY b.created_at DESC, b.id DESC))[1] AS intent_target,
        (array_agg(b.traffic_source ORDER BY b.created_at DESC, b.id DESC))[1] AS traffic_source,
        (array_agg(b.traffic_medium ORDER BY b.created_at DESC, b.id DESC))[1] AS traffic_medium,
        GREATEST(
          COALESCE(MAX(b.intent_phone_clicks), 0),
          COALESCE(SUM(CASE WHEN b.intent_action = 'phone' THEN 1 ELSE 0 END), 0)
        ) AS phone_clicks,
        GREATEST(
          COALESCE(MAX(b.intent_whatsapp_clicks), 0),
          COALESCE(SUM(CASE WHEN b.intent_action = 'whatsapp' THEN 1 ELSE 0 END), 0)
        ) AS whatsapp_clicks,
        GREATEST(
          COALESCE(MAX(COALESCE(b.intent_phone_clicks, 0) + COALESCE(b.intent_whatsapp_clicks, 0)), 0),
          COUNT(*)::int
        ) AS intent_events
      FROM base b
      WHERE b.matched_session_id IS NOT NULL
      GROUP BY b.matched_session_id
    )
    SELECT COALESCE(
      ARRAY(
        SELECT jsonb_build_object(
          'id', a.id,
          'created_at', a.created_at,
          'status', a.status,
          'matched_session_id', a.matched_session_id,
          'intent_action', a.intent_action,
          'summary', COALESCE(NULLIF(BTRIM(a.intent_target), ''), NULLIF(BTRIM(a.intent_action), ''), 'intent'),
          'phone_clicks', a.phone_clicks,
          'whatsapp_clicks', a.whatsapp_clicks,
          'intent_events', a.intent_events,
          'traffic_source', a.traffic_source,
          'traffic_medium', a.traffic_medium
        )
        FROM agg a
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT v_limit
      ),
      ARRAY[]::jsonb[]
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, int, boolean) TO service_role;

-- -----------------------------------------------------------------------------
-- get_intent_details_v1: include traffic_source / traffic_medium
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_intent_details_v1(
  p_site_id uuid,
  p_call_id uuid
)
RETURNS jsonb
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
      RAISE EXCEPTION USING MESSAGE = 'not_authenticated', ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.sites s0
      WHERE s0.id = p_site_id
        AND (
          s0.user_id = v_user_id
          OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s0.id AND sm.user_id = v_user_id)
          OR public.is_admin(v_user_id)
        )
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN (
    SELECT to_jsonb(x)
    FROM (
      SELECT
        c.id AS id,
        c.created_at AS created_at,
        c.intent_action AS intent_action,
        c.intent_target AS intent_target,
        c.intent_stamp AS intent_stamp,
        COALESCE(c.intent_page_url, s.entry_page) AS intent_page_url,
        COALESCE(c.intent_page_url, s.entry_page) AS page_url,
        c.matched_session_id AS matched_session_id,
        c.lead_score AS lead_score,
        c.status AS status,
        COALESCE(c.click_id, s.gclid, s.wbraid, s.gbraid) AS click_id,

        -- Session attribution
        s.traffic_source AS traffic_source,
        s.traffic_medium AS traffic_medium,

        -- Session-based click evidence counts (back-compat with legacy multi-row sessions)
        GREATEST(
          COALESCE((
            SELECT MAX(COALESCE(c2.intent_phone_clicks, 0))
            FROM public.calls c2
            WHERE c2.site_id = p_site_id
              AND c2.source = 'click'
              AND c2.matched_session_id = c.matched_session_id
          ), 0),
          COALESCE((
            SELECT COUNT(*)
            FROM public.calls c3
            WHERE c3.site_id = p_site_id
              AND c3.source = 'click'
              AND c3.matched_session_id = c.matched_session_id
              AND (c3.status IS NULL OR c3.status = 'intent')
              AND c3.intent_action = 'phone'
          ), 0)
        ) AS phone_clicks,
        GREATEST(
          COALESCE((
            SELECT MAX(COALESCE(c2.intent_whatsapp_clicks, 0))
            FROM public.calls c2
            WHERE c2.site_id = p_site_id
              AND c2.source = 'click'
              AND c2.matched_session_id = c.matched_session_id
          ), 0),
          COALESCE((
            SELECT COUNT(*)
            FROM public.calls c3
            WHERE c3.site_id = p_site_id
              AND c3.source = 'click'
              AND c3.matched_session_id = c.matched_session_id
              AND (c3.status IS NULL OR c3.status = 'intent')
              AND c3.intent_action = 'whatsapp'
          ), 0)
        ) AS whatsapp_clicks,

        -- Evidence click ids (session)
        s.gclid AS gclid,
        s.wbraid AS wbraid,
        s.gbraid AS gbraid,

        -- Financial
        c.estimated_value AS estimated_value,
        (SELECT sites.currency FROM public.sites WHERE sites.id = p_site_id) AS currency,

        -- Session intelligence (UTM / Ads)
        s.utm_term AS utm_term,
        s.utm_campaign AS utm_campaign,
        s.utm_source AS utm_source,
        s.utm_medium AS utm_medium,
        s.utm_content AS utm_content,
        s.matchtype AS matchtype,
        s.ads_network AS ads_network,
        s.ads_placement AS ads_placement,

        -- Device / Hardware DNA
        s.device_type AS device_type,
        s.device_os AS device_os,
        s.browser AS browser,
        s.browser_language AS browser_language,
        s.device_memory AS device_memory,
        s.hardware_concurrency AS hardware_concurrency,
        s.screen_width AS screen_width,
        s.screen_height AS screen_height,
        s.pixel_ratio AS pixel_ratio,
        s.gpu_renderer AS gpu_renderer,
        s.connection_type AS connection_type,

        -- Behavior (Intent Pulse)
        s.max_scroll_percentage AS max_scroll_percentage,
        s.cta_hover_count AS cta_hover_count,
        s.form_focus_duration AS form_focus_duration,
        s.total_active_seconds AS total_active_seconds,
        s.engagement_score AS engagement_score,

        -- Identity / Returning giant
        s.is_returning AS is_returning,
        s.visitor_rank AS visitor_rank,
        COALESCE(s.previous_visit_count, 0) AS previous_visit_count,
        s.referrer_host AS referrer_host,

        -- Geo / Carrier / Proxy
        s.city AS city,
        s.district AS district,
        s.telco_carrier AS telco_carrier,
        s.isp_asn AS isp_asn,
        COALESCE(s.is_proxy_detected, false) AS is_proxy_detected,

        -- Attribution + session summary
        s.attribution_source AS attribution_source,
        s.total_duration_sec AS total_duration_sec,
        s.event_count AS event_count,

        -- AI (if present on sessions)
        s.ai_score AS ai_score,
        s.ai_summary AS ai_summary,
        s.ai_tags AS ai_tags,

        -- OCI status fields (calls)
        c.oci_status AS oci_status,
        c.oci_status_updated_at AS oci_status_updated_at,
        c.oci_uploaded_at AS oci_uploaded_at,
        c.oci_batch_id AS oci_batch_id,
        c.oci_error AS oci_error
      FROM public.calls c
      LEFT JOIN public.sessions s
        ON s.id = c.matched_session_id
       AND s.site_id = p_site_id
      WHERE c.site_id = p_site_id
        AND c.id = p_call_id
      LIMIT 1
    ) x
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_intent_details_v1(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_intent_details_v1(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_intent_details_v1(uuid, uuid) TO service_role;

COMMIT;

