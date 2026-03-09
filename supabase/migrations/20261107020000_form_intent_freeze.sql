BEGIN;

ALTER TABLE public.calls
  DROP CONSTRAINT IF EXISTS calls_click_intent_invariants_chk;

ALTER TABLE public.calls
  ADD CONSTRAINT calls_click_intent_invariants_chk
  CHECK (
    source <> 'click'
    OR (
      intent_action IN ('phone', 'whatsapp', 'form')
      AND intent_target IS NOT NULL AND intent_target <> ''
      AND intent_stamp IS NOT NULL AND intent_stamp <> ''
    )
  ) NOT VALID;

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
  IF v_action NOT IN ('phone', 'whatsapp', 'form') THEN
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
      WHEN public.calls.status IS NULL OR public.calls.status = 'intent' THEN 'intent'
      ELSE public.calls.status
    END,
    matched_session_id = COALESCE(public.calls.matched_session_id, EXCLUDED.matched_session_id),
    matched_fingerprint = COALESCE(public.calls.matched_fingerprint, EXCLUDED.matched_fingerprint),
    lead_score = GREATEST(COALESCE(public.calls.lead_score, 0), COALESCE(EXCLUDED.lead_score, 0)),
    lead_score_at_match = GREATEST(COALESCE(public.calls.lead_score_at_match, 0), COALESCE(EXCLUDED.lead_score_at_match, 0)),
    intent_action = CASE
      WHEN EXCLUDED.intent_action = 'form' AND public.calls.intent_action IN ('phone', 'whatsapp') THEN public.calls.intent_action
      ELSE EXCLUDED.intent_action
    END,
    intent_target = CASE
      WHEN EXCLUDED.intent_action = 'form' AND public.calls.intent_action IN ('phone', 'whatsapp')
        THEN public.calls.intent_target
      ELSE COALESCE(EXCLUDED.intent_target, public.calls.intent_target)
    END,
    intent_page_url = COALESCE(EXCLUDED.intent_page_url, public.calls.intent_page_url),
    click_id = COALESCE(EXCLUDED.click_id, public.calls.click_id),
    intent_phone_clicks = COALESCE(public.calls.intent_phone_clicks, 0) + CASE WHEN EXCLUDED.intent_action = 'phone' THEN 1 ELSE 0 END,
    intent_whatsapp_clicks = COALESCE(public.calls.intent_whatsapp_clicks, 0) + CASE WHEN EXCLUDED.intent_action = 'whatsapp' THEN 1 ELSE 0 END,
    intent_last_at = now()
  RETURNING public.calls.id INTO v_id;

  RETURN v_id;
END;
$$;

COMMIT;
