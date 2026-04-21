BEGIN;

-- Core spine: expose calls.version on intent RPCs for seal optimistic locking (panel sends real version).
-- Re-applies latest lite + details definitions from 20261108190000 with version column; adds version to v2.

-- Intent card hardening:
-- 1) Prefer Ads/GCLID geo over IP geo for district rendering.
-- 2) Surface stable location_source='gclid' when geo came from Google Ads metadata.
-- 3) Keep queue/details RPCs aligned so lite and full cards show the same district/source story.

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
    SELECT COALESCE(
      ARRAY(
        SELECT jsonb_build_object(
          'id', c.id,
          'version', COALESCE(c.version, 0),
          'created_at', c.created_at,
          'status', c.status,
          'matched_session_id', c.matched_session_id,
          'intent_action', c.intent_action,
          'summary', COALESCE(NULLIF(BTRIM(c.intent_target), ''), NULLIF(BTRIM(c.intent_action), ''), 'intent'),
          'intent_target', c.intent_target,
          'intent_page_url', COALESCE(c.intent_page_url, s.entry_page),
          'page_url', COALESCE(c.intent_page_url, s.entry_page),
          'click_id', COALESCE(c.click_id, s.gclid, s.wbraid, s.gbraid),
          'form_state', c.form_state,
          'form_summary', c.form_summary,
          'traffic_source', s.traffic_source,
          'traffic_medium', s.traffic_medium,
          'attribution_source', s.attribution_source,
          'gclid', s.gclid,
          'wbraid', s.wbraid,
          'gbraid', s.gbraid,
          'utm_term', s.utm_term,
          'utm_campaign', s.utm_campaign,
          'utm_source', s.utm_source,
          'matchtype', s.matchtype,
          'city', CASE
            WHEN c.location_source = 'gclid' AND NULLIF(BTRIM(COALESCE(c.district_name, '')), '') IS NOT NULL THEN NULL
            WHEN NULLIF(BTRIM(COALESCE(s.geo_district, '')), '') IS NOT NULL THEN NULL
            ELSE s.city
          END,
          'district', COALESCE(
            NULLIF(CASE WHEN c.location_source = 'gclid' THEN BTRIM(COALESCE(c.district_name, '')) END, ''),
            NULLIF(BTRIM(COALESCE(s.geo_district, '')), ''),
            NULLIF(BTRIM(COALESCE(s.district, '')), '')
          ),
          'location_source', CASE
            WHEN c.location_source = 'gclid' AND NULLIF(BTRIM(COALESCE(c.district_name, '')), '') IS NOT NULL THEN 'gclid'
            WHEN NULLIF(BTRIM(COALESCE(s.geo_district, '')), '') IS NOT NULL
              AND NULLIF(BTRIM(COALESCE(s.loc_physical_ms, '')), '') IS NOT NULL THEN 'gclid'
            ELSE c.location_source
          END,
          'device_type', s.device_type,
          'device_os', s.device_os,
          'total_duration_sec', s.total_duration_sec,
          'event_count', s.event_count,
          'estimated_value', c.estimated_value,
          'currency', sites.currency,
          'phone_clicks', GREATEST(
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
          ),
          'whatsapp_clicks', GREATEST(
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
          )
        )
        FROM public.calls c
        LEFT JOIN public.sessions s
          ON s.id = c.matched_session_id
         AND s.site_id = p_site_id
        LEFT JOIN public.sites sites
          ON sites.id = p_site_id
        WHERE c.site_id = p_site_id
          AND c.source = 'click'
          AND (c.status IS NULL OR c.status = 'intent')
          AND c.created_at >= v_from
          AND c.created_at < v_to
          AND (
            c.matched_session_id IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM public.calls c2
              WHERE c2.site_id = p_site_id
                AND c2.matched_session_id = c.matched_session_id
                AND c2.status IN ('junk', 'cancelled')
            )
          )
          AND (
            p_ads_only = false
            OR EXISTS (
              SELECT 1
              FROM public.sessions s2
              WHERE s2.id = c.matched_session_id
                AND s2.site_id = p_site_id
                AND public.is_ads_session(s2)
            )
          )
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT v_limit
      ),
      ARRAY[]::jsonb[]
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, int, boolean) IS
  'Pending intents queue with hardened source + geo fidelity plus calls.version for seal optimistic locking.';

REVOKE ALL ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, int, boolean) TO service_role;

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
        COALESCE(c.version, 0) AS version,
        COALESCE(c.click_id, s.gclid, s.wbraid, s.gbraid) AS click_id,
        c.form_state AS form_state,
        c.form_summary AS form_summary,
        s.traffic_source AS traffic_source,
        s.traffic_medium AS traffic_medium,
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
        s.gclid AS gclid,
        s.wbraid AS wbraid,
        s.gbraid AS gbraid,
        c.estimated_value AS estimated_value,
        (SELECT sites.currency FROM public.sites WHERE sites.id = p_site_id) AS currency,
        s.utm_term AS utm_term,
        s.utm_campaign AS utm_campaign,
        s.utm_source AS utm_source,
        s.utm_medium AS utm_medium,
        s.utm_content AS utm_content,
        s.matchtype AS matchtype,
        s.ads_network AS ads_network,
        s.ads_placement AS ads_placement,
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
        s.max_scroll_percentage AS max_scroll_percentage,
        s.cta_hover_count AS cta_hover_count,
        s.form_focus_duration AS form_focus_duration,
        s.total_active_seconds AS total_active_seconds,
        s.engagement_score AS engagement_score,
        s.is_returning AS is_returning,
        s.visitor_rank AS visitor_rank,
        COALESCE(s.previous_visit_count, 0) AS previous_visit_count,
        s.referrer_host AS referrer_host,
        CASE
          WHEN c.location_source = 'gclid' AND NULLIF(BTRIM(COALESCE(c.district_name, '')), '') IS NOT NULL THEN NULL
          WHEN NULLIF(BTRIM(COALESCE(s.geo_district, '')), '') IS NOT NULL THEN NULL
          ELSE s.city
        END AS city,
        COALESCE(
          NULLIF(CASE WHEN c.location_source = 'gclid' THEN BTRIM(COALESCE(c.district_name, '')) END, ''),
          NULLIF(BTRIM(COALESCE(s.geo_district, '')), ''),
          NULLIF(BTRIM(COALESCE(s.district, '')), '')
        ) AS district,
        CASE
          WHEN c.location_source = 'gclid' AND NULLIF(BTRIM(COALESCE(c.district_name, '')), '') IS NOT NULL THEN 'gclid'
          WHEN NULLIF(BTRIM(COALESCE(s.geo_district, '')), '') IS NOT NULL
            AND NULLIF(BTRIM(COALESCE(s.loc_physical_ms, '')), '') IS NOT NULL THEN 'gclid'
          ELSE c.location_source
        END AS location_source,
        s.telco_carrier AS telco_carrier,
        s.isp_asn AS isp_asn,
        COALESCE(s.is_proxy_detected, false) AS is_proxy_detected,
        s.attribution_source AS attribution_source,
        s.total_duration_sec AS total_duration_sec,
        s.event_count AS event_count,
        s.ai_score AS ai_score,
        s.ai_summary AS ai_summary,
        s.ai_tags AS ai_tags,
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

COMMENT ON FUNCTION public.get_intent_details_v1(uuid, uuid) IS
  'Intent details with hardened source and GCLID-first district fidelity for operator review.';

REVOKE ALL ON FUNCTION public.get_intent_details_v1(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_intent_details_v1(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_intent_details_v1(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_recent_intents_v2(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_limit int DEFAULT 200,
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

  v_from := p_date_from;
  v_to := p_date_to;
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));

  RETURN (
    SELECT COALESCE(
      ARRAY(
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
            COALESCE(c.version, 0) AS version,
            COALESCE(c.click_id, s.gclid, s.wbraid, s.gbraid) AS click_id,
            s.gclid AS gclid,
            s.wbraid AS wbraid,
            s.gbraid AS gbraid,
            c.estimated_value AS estimated_value,
            (SELECT sites.currency FROM public.sites WHERE sites.id = p_site_id) AS currency,
            s.utm_term AS utm_term,
            s.utm_campaign AS utm_campaign,
            s.utm_source AS utm_source,
            s.utm_medium AS utm_medium,
            s.utm_content AS utm_content,
            s.matchtype AS matchtype,
            s.ads_network AS ads_network,
            s.ads_placement AS ads_placement,
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
            s.max_scroll_percentage AS max_scroll_percentage,
            s.cta_hover_count AS cta_hover_count,
            s.form_focus_duration AS form_focus_duration,
            s.total_active_seconds AS total_active_seconds,
            s.engagement_score AS engagement_score,
            s.is_returning AS is_returning,
            s.visitor_rank AS visitor_rank,
            COALESCE(s.previous_visit_count, 0) AS previous_visit_count,
            s.referrer_host AS referrer_host,
            CASE WHEN c.location_source = 'gclid' AND NULLIF(BTRIM(COALESCE(c.district_name, '')), '') IS NOT NULL THEN NULL ELSE s.city END AS city,
            CASE WHEN c.location_source = 'gclid' AND NULLIF(BTRIM(COALESCE(c.district_name, '')), '') IS NOT NULL THEN c.district_name ELSE s.district END AS district,
            c.location_source AS location_source,
            s.telco_carrier AS telco_carrier,
            s.isp_asn AS isp_asn,
            COALESCE(s.is_proxy_detected, false) AS is_proxy_detected,
            s.attribution_source AS attribution_source,
            s.total_duration_sec AS total_duration_sec,
            s.event_count AS event_count,
            s.ai_score AS ai_score,
            s.ai_summary AS ai_summary,
            s.ai_tags AS ai_tags,
            c.oci_status AS oci_status,
            c.oci_status_updated_at AS oci_status_updated_at,
            c.oci_uploaded_at AS oci_uploaded_at,
            c.oci_batch_id AS oci_batch_id,
            c.oci_error AS oci_error,
            (
              COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL
              OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
              OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
              OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
            ) AS oci_matchable,
            to_jsonb(array_remove(ARRAY[
              CASE WHEN (COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NULL) AND (COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NULL) AND (COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NULL) AND (COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NULL) THEN 'High Risk: Click ID yok' END,
              CASE WHEN s.total_duration_sec IS NOT NULL AND s.total_duration_sec <= 3 THEN 'High Risk: 3sn altı kalış' END,
              CASE WHEN s.event_count IS NOT NULL AND s.event_count <= 1 THEN 'High Risk: Düşük etkileşim' END,
              CASE WHEN s.attribution_source IS NOT NULL AND LOWER(s.attribution_source) LIKE '%organic%' THEN 'High Risk: Organic trafik' END
            ], NULL)) AS risk_reasons,
            CASE
              WHEN (COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NULL AND COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NULL AND COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NULL AND COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NULL)
                OR (s.total_duration_sec IS NOT NULL AND s.total_duration_sec <= 3)
                OR (s.event_count IS NOT NULL AND s.event_count <= 1)
              THEN 'high'
              ELSE 'low'
            END AS risk_level,
            CASE
              WHEN c.status IN ('confirmed','qualified','real') AND c.oci_status = 'uploaded' AND (COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL) THEN 'matched'
              WHEN c.status IN ('confirmed','qualified','real') AND c.oci_status = 'uploaded' THEN 'uploaded'
              WHEN c.status IN ('confirmed','qualified','real') THEN 'sealed'
              ELSE 'pending'
            END AS oci_stage
          FROM public.calls c
          LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
          WHERE c.site_id = p_site_id
            AND c.source = 'click'
            AND (c.status IN ('intent','confirmed','qualified','real') OR c.status IS NULL)
            AND (
              c.status IN ('confirmed','qualified','real')
              OR c.matched_session_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM public.calls c2
                WHERE c2.site_id = p_site_id
                  AND c2.matched_session_id = c.matched_session_id
                  AND c2.status IN ('junk','cancelled')
              )
            )
            AND c.created_at >= v_from
            AND c.created_at <= v_to
            AND (p_ads_only = false OR (s.id IS NOT NULL AND public.is_ads_session(s)))
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT v_limit
        ) x
      ),
      ARRAY[]::jsonb[]
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_recent_intents_v2(uuid, timestamptz, timestamptz, int, boolean) IS
  'Recent intents for queue/dashboard. Excludes junk/cancelled; includes calls.version for optimistic seal.';

REVOKE ALL ON FUNCTION public.get_recent_intents_v2(uuid, timestamptz, timestamptz, int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_v2(uuid, timestamptz, timestamptz, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_v2(uuid, timestamptz, timestamptz, int, boolean) TO service_role;

COMMIT;
