-- Session-based single-card intents (Hunter Queue)
--
-- Goal:
-- - Prevent "one person => multiple queue items" by deduping click-intents per session
-- - Preserve action evidence by counting clicks per action (phone / whatsapp)
-- - Keep backward compatibility by making RPCs compute counts from either:
--   - new counter columns (future) OR
--   - legacy multiple-rows-per-session (past)
--
-- Changes:
-- 1) calls: add intent_phone_clicks, intent_whatsapp_clicks, intent_last_at
-- 2) RPC: ensure_session_intent_v1(...) inserts/updates a single call row per session with atomic increments
-- 3) RPC: get_recent_intents_lite_v1 now returns ONE row per matched_session_id + click counts
-- 4) RPC: get_intent_details_v1 returns click counts as well

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Schema: per-session click counters
-- -----------------------------------------------------------------------------

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS intent_phone_clicks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intent_whatsapp_clicks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intent_last_at timestamptz NULL;

-- -----------------------------------------------------------------------------
-- 2) RPC: atomic ensure per session (single row)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_session_intent_v1(
  p_site_id uuid,
  p_session_id uuid,
  p_fingerprint text,
  p_lead_score integer,
  p_intent_action text,
  p_intent_target text,
  p_intent_page_url text,
  p_click_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stamp text;
  v_id uuid;
  v_action text;
BEGIN
  IF p_site_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_params', ERRCODE = 'P0001';
  END IF;

  v_stamp := 'session:' || p_session_id::text;
  v_action := lower(coalesce(p_intent_action, ''));
  IF v_action <> 'phone' AND v_action <> 'whatsapp' THEN
    v_action := 'other';
  END IF;

  INSERT INTO public.calls (
    site_id,
    phone_number,
    matched_session_id,
    matched_fingerprint,
    lead_score,
    lead_score_at_match,
    status,
    source,
    intent_stamp,
    intent_action,
    intent_target,
    intent_page_url,
    click_id,
    intent_phone_clicks,
    intent_whatsapp_clicks,
    intent_last_at
  )
  VALUES (
    p_site_id,
    COALESCE(NULLIF(BTRIM(p_intent_target), ''), 'Unknown'),
    p_session_id,
    NULLIF(BTRIM(p_fingerprint), ''),
    COALESCE(p_lead_score, 0),
    COALESCE(p_lead_score, 0),
    'intent',
    'click',
    v_stamp,
    v_action,
    NULLIF(BTRIM(p_intent_target), ''),
    NULLIF(BTRIM(p_intent_page_url), ''),
    NULLIF(BTRIM(p_click_id), ''),
    CASE WHEN v_action = 'phone' THEN 1 ELSE 0 END,
    CASE WHEN v_action = 'whatsapp' THEN 1 ELSE 0 END,
    now()
  )
  ON CONFLICT (site_id, intent_stamp) DO UPDATE
  SET
    -- keep status pending unless already qualified; manual qualification will update status.
    status = CASE
      WHEN public.calls.status IS NULL OR public.calls.status = 'intent' THEN 'intent'
      ELSE public.calls.status
    END,
    matched_session_id = COALESCE(public.calls.matched_session_id, EXCLUDED.matched_session_id),
    matched_fingerprint = COALESCE(public.calls.matched_fingerprint, EXCLUDED.matched_fingerprint),
    lead_score = GREATEST(COALESCE(public.calls.lead_score, 0), COALESCE(EXCLUDED.lead_score, 0)),
    lead_score_at_match = GREATEST(COALESCE(public.calls.lead_score_at_match, 0), COALESCE(EXCLUDED.lead_score_at_match, 0)),
    intent_action = EXCLUDED.intent_action,
    intent_target = COALESCE(EXCLUDED.intent_target, public.calls.intent_target),
    intent_page_url = COALESCE(EXCLUDED.intent_page_url, public.calls.intent_page_url),
    click_id = COALESCE(EXCLUDED.click_id, public.calls.click_id),
    intent_phone_clicks = COALESCE(public.calls.intent_phone_clicks, 0) + CASE WHEN EXCLUDED.intent_action = 'phone' THEN 1 ELSE 0 END,
    intent_whatsapp_clicks = COALESCE(public.calls.intent_whatsapp_clicks, 0) + CASE WHEN EXCLUDED.intent_action = 'whatsapp' THEN 1 ELSE 0 END,
    intent_last_at = now()
  RETURNING public.calls.id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_session_intent_v1(uuid, uuid, text, integer, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_session_intent_v1(uuid, uuid, text, integer, text, text, text, text) TO service_role;

-- -----------------------------------------------------------------------------
-- 3) Lite list RPC: ONE row per session (single card) + action counts
-- Contract remains:
--   get_recent_intents_lite_v1(p_site_id, p_date_from, p_date_to, p_limit, p_ads_only) returns jsonb[]
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
        c.intent_whatsapp_clicks
      FROM public.calls c
      WHERE c.site_id = p_site_id
        AND c.source = 'click'
        AND (c.status IS NULL OR c.status = 'intent')
        AND c.created_at >= v_from
        AND c.created_at < v_to
        AND (
          p_ads_only = false
          OR EXISTS (
            SELECT 1
            FROM public.sessions s
            WHERE s.id = c.matched_session_id
              AND s.site_id = p_site_id
              AND public.is_ads_session(s)
          )
        )
    ),
    agg AS (
      SELECT
        b.matched_session_id,
        -- pick latest row as the "card identity" (drawer key)
        (array_agg(b.id ORDER BY b.created_at DESC, b.id DESC))[1] AS id,
        MAX(b.created_at) AS created_at,
        COALESCE(MAX(b.status), 'intent') AS status,
        (array_agg(b.intent_action ORDER BY b.created_at DESC, b.id DESC))[1] AS intent_action,
        (array_agg(b.intent_target ORDER BY b.created_at DESC, b.id DESC))[1] AS intent_target,
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
          'intent_events', a.intent_events
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
-- 4) Details RPC: add action counts (phone/whatsapp) to payload
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

