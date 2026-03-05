-- Çöpe gönderilen intent'lerin geri gelmesini tam kesmek:
-- 1) ensure_session_intent_v1: junk/cancelled önce kontrol — aynı session tekrar tıklasa bile status junk kalır.
-- 2) get_recent_intents_lite_v1: Aynı session'da herhangi bir call junk/cancelled ise o session hiç listelenmez.
-- Böylece tek satır junk'lansa bile aynı session'daki diğer satırlar da kuyrukta görünmez.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) ensure_session_intent_v1: Junk/cancelled asla 'intent'e dönmesin
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
    status = CASE
      WHEN public.calls.status IN ('junk','cancelled') THEN public.calls.status
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

COMMENT ON FUNCTION public.ensure_session_intent_v1(uuid, uuid, text, integer, text, text, text, text) IS
  'Junk/cancelled status is never overwritten by new clicks (same session).';

REVOKE ALL ON FUNCTION public.ensure_session_intent_v1(uuid, uuid, text, integer, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_session_intent_v1(uuid, uuid, text, integer, text, text, text, text) TO service_role;


-- -----------------------------------------------------------------------------
-- 2) get_recent_intents_lite_v1: Session'da herhangi bir junk/cancelled varsa o session listelenmez
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
          'summary', COALESCE(NULLIF(BTRIM(c.intent_target), ''), NULLIF(BTRIM(c.intent_action), ''), 'intent')
        )
        FROM public.calls c
        WHERE c.site_id = p_site_id
          AND c.source = 'click'
          AND (c.status IS NULL OR c.status = 'intent')
          AND c.created_at >= v_from
          AND c.created_at < v_to
          AND (
            c.matched_session_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM public.calls c2
              WHERE c2.site_id = p_site_id
                AND c2.matched_session_id = c.matched_session_id
                AND c2.status IN ('junk','cancelled')
            )
          )
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
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT v_limit
      ),
      ARRAY[]::jsonb[]
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, int, boolean) IS
  'Pending intents only. Sessions that have any junk/cancelled call are hidden from queue.';

REVOKE ALL ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, int, boolean) TO service_role;

COMMIT;
