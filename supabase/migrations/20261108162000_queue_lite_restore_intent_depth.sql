BEGIN;

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
          'city', s.city,
          'district', s.district,
          'location_source', s.location_source,
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
  'Pending intents queue with restored operator depth: keyword, source, click ids, device, geo, estimated value, and form summary.';

REVOKE ALL ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, int, boolean) TO service_role;

COMMIT;
