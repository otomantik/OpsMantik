-- Add Hunter AI fields (ai_score, ai_summary, ai_tags from session) to get_recent_intents_v2 output.
-- Dashboard HunterCard uses these for HOT LEAD badge and Intel Box.

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
      RAISE EXCEPTION USING MESSAGE = 'not_authenticated', DETAIL = 'User must be authenticated', ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.sites s0
      WHERE s0.id = p_site_id
        AND (s0.user_id = v_user_id OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s0.id AND sm.user_id = v_user_id) OR public.is_admin(v_user_id))
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'Access denied to this site', ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_date_from IS NULL OR p_date_to IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_range', DETAIL = 'p_date_from and p_date_to are required', ERRCODE = 'P0001';
  END IF;
  v_from := p_date_from;
  v_to := p_date_to;
  IF v_to < v_from THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_range', DETAIL = 'p_date_to must be >= p_date_from', ERRCODE = 'P0001';
  END IF;
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));

  RETURN (
    SELECT COALESCE(
      ARRAY(
        SELECT jsonb_build_object(
          'id', c.id,
          'created_at', c.created_at,
          'intent_action', c.intent_action,
          'intent_target', c.intent_target,
          'intent_stamp', c.intent_stamp,
          'intent_page_url', COALESCE(c.intent_page_url, s.entry_page),
          'matched_session_id', c.matched_session_id,
          'lead_score', c.lead_score,
          'status', c.status,
          'click_id', COALESCE(c.click_id, s.gclid, s.wbraid, s.gbraid),
          'oci_status', c.oci_status,
          'oci_status_updated_at', c.oci_status_updated_at,
          'oci_uploaded_at', c.oci_uploaded_at,
          'oci_batch_id', c.oci_batch_id,
          'oci_error', c.oci_error,
          'attribution_source', s.attribution_source,
          'gclid', s.gclid,
          'wbraid', s.wbraid,
          'gbraid', s.gbraid,
          'total_duration_sec', s.total_duration_sec,
          'event_count', s.event_count,
          'oci_matchable', (
            COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL
            OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
            OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
            OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
          ),
          'risk_reasons', to_jsonb(array_remove(ARRAY[
            CASE WHEN (COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NULL) AND (COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NULL) AND (COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NULL) AND (COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NULL) THEN 'High Risk: Click ID yok (GCLID/WBRAID/GBRAID bulunamadı)' END,
            CASE WHEN s.total_duration_sec IS NOT NULL AND s.total_duration_sec <= 3 THEN 'High Risk: Sitede 3 saniye (veya daha az) kaldı' END,
            CASE WHEN s.event_count IS NOT NULL AND s.event_count <= 1 THEN 'High Risk: Tek etkileşim (event_count<=1)' END,
            CASE WHEN s.attribution_source IS NOT NULL AND LOWER(s.attribution_source) LIKE '%organic%' THEN 'High Risk: Attribution Organic görünüyor' END
          ], NULL)),
          'risk_level', CASE
            WHEN ((COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NULL) AND (COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NULL) AND (COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NULL) AND (COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NULL))
              OR (s.total_duration_sec IS NOT NULL AND s.total_duration_sec <= 3)
              OR (s.event_count IS NOT NULL AND s.event_count <= 1)
            THEN 'high'
            ELSE 'low'
          END,
          'oci_stage', CASE
            WHEN c.status IN ('confirmed','qualified','real') AND c.oci_status = 'uploaded' AND (COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL) THEN 'matched'
            WHEN c.status IN ('confirmed','qualified','real') AND c.oci_status = 'uploaded' THEN 'uploaded'
            WHEN c.status IN ('confirmed','qualified','real') THEN 'sealed'
            ELSE 'pending'
          END,
          'ai_score', s.ai_score,
          'ai_summary', s.ai_summary,
          'ai_tags', s.ai_tags
        )
        FROM public.calls c
        LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
        WHERE c.site_id = p_site_id
          AND c.source = 'click'
          AND (c.status IN ('intent','confirmed','junk') OR c.status IS NULL)
          AND c.created_at >= v_from
          AND c.created_at <= v_to
          AND (p_ads_only = false OR (s.id IS NOT NULL AND public.is_ads_session(s)))
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT v_limit
      ),
      ARRAY[]::jsonb[]
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_recent_intents_v2(uuid, timestamptz, timestamptz, int, boolean)
IS 'Live Inbox RPC: recent click intents + Hunter AI fields (ai_score, ai_summary, ai_tags) from session.';
