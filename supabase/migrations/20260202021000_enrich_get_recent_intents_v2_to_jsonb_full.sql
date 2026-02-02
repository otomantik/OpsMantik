-- =============================================================================
-- Enrich: get_recent_intents_v2 (to_jsonb version) with full HunterCard fields
--
-- After fixing the 100-arg limit, restore/keep the expected response keys used
-- by the dashboard (AI, behavior, click ids, etc.).
-- =============================================================================

BEGIN;

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
            -- Core call intent fields
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
            c.oci_error AS oci_error,

            -- Matchability / Risk engine
            (
              COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL
              OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
              OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
              OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
            ) AS oci_matchable,

            to_jsonb(array_remove(ARRAY[
              CASE
                WHEN (COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NULL)
                  AND (COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NULL)
                  AND (COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NULL)
                  AND (COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NULL)
                THEN 'High Risk: Click ID yok'
              END,
              CASE
                WHEN s.total_duration_sec IS NOT NULL AND s.total_duration_sec <= 3
                THEN 'High Risk: 3sn altı kalış'
              END,
              CASE
                WHEN s.event_count IS NOT NULL AND s.event_count <= 1
                THEN 'High Risk: Düşük etkileşim'
              END,
              CASE
                WHEN s.attribution_source IS NOT NULL AND LOWER(s.attribution_source) LIKE '%organic%'
                THEN 'High Risk: Organic trafik'
              END
            ], NULL)) AS risk_reasons,

            CASE
              WHEN (
                COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NULL
                AND COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NULL
                AND COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NULL
                AND COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NULL
              )
              OR (s.total_duration_sec IS NOT NULL AND s.total_duration_sec <= 3)
              OR (s.event_count IS NOT NULL AND s.event_count <= 1)
              THEN 'high'
              ELSE 'low'
            END AS risk_level,

            CASE
              WHEN c.status IN ('confirmed','qualified','real')
                AND c.oci_status = 'uploaded'
                AND (
                  COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL
                  OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
                  OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
                  OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
                )
              THEN 'matched'
              WHEN c.status IN ('confirmed','qualified','real') AND c.oci_status = 'uploaded' THEN 'uploaded'
              WHEN c.status IN ('confirmed','qualified','real') THEN 'sealed'
              ELSE 'pending'
            END AS oci_stage
          FROM public.calls c
          LEFT JOIN public.sessions s
            ON s.id = c.matched_session_id
           AND s.site_id = p_site_id
          WHERE c.site_id = p_site_id
            AND c.source = 'click'
            AND (c.status IN ('intent','confirmed','junk') OR c.status IS NULL)
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

REVOKE ALL ON FUNCTION public.get_recent_intents_v2(uuid, timestamptz, timestamptz, int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_v2(uuid, timestamptz, timestamptz, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_v2(uuid, timestamptz, timestamptz, int, boolean) TO service_role;

COMMIT;

