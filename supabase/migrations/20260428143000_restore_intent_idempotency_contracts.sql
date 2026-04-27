-- Restore critical intent idempotency contracts lost during reset.
-- Sources: previously deleted migrations around calls intent_stamp uniqueness and single-card session intent RPC.
BEGIN;

-- 1) Ensure columns used by idempotency + queue depth exist.
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS intent_stamp text,
  ADD COLUMN IF NOT EXISTS intent_action text,
  ADD COLUMN IF NOT EXISTS intent_target text,
  ADD COLUMN IF NOT EXISTS intent_page_url text,
  ADD COLUMN IF NOT EXISTS click_id text,
  ADD COLUMN IF NOT EXISTS event_id uuid,
  ADD COLUMN IF NOT EXISTS signature_hash text,
  ADD COLUMN IF NOT EXISTS form_state text,
  ADD COLUMN IF NOT EXISTS form_summary jsonb,
  ADD COLUMN IF NOT EXISTS intent_phone_clicks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intent_whatsapp_clicks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intent_last_at timestamptz null;

-- 2) Clean duplicate keys before creating unique guards.
-- Keep newest row per (site_id, intent_stamp).
WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY site_id, intent_stamp
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.calls
  WHERE intent_stamp IS NOT NULL
)
DELETE FROM public.calls c
USING ranked r
WHERE c.ctid = r.ctid
  AND r.rn > 1;

-- Keep newest row per (site_id, event_id).
WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY site_id, event_id
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.calls
  WHERE event_id IS NOT NULL
)
DELETE FROM public.calls c
USING ranked r
WHERE c.ctid = r.ctid
  AND r.rn > 1;

-- Keep newest row per (site_id, signature_hash).
WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY site_id, signature_hash
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.calls
  WHERE signature_hash IS NOT NULL
)
DELETE FROM public.calls c
USING ranked r
WHERE c.ctid = r.ctid
  AND r.rn > 1;

-- 3) Recreate hard idempotency constraints.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'calls_site_intent_stamp_uniq'
      AND conrelid = 'public.calls'::regclass
  ) THEN
    ALTER TABLE public.calls
      ADD CONSTRAINT calls_site_intent_stamp_uniq
      UNIQUE (site_id, intent_stamp);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_site_event_id_uniq
  ON public.calls(site_id, event_id)
  WHERE event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS calls_site_signature_hash_uq
  ON public.calls(site_id, signature_hash)
  WHERE signature_hash IS NOT NULL;

-- Fallback dedupe support for semantic short-window checks.
CREATE INDEX IF NOT EXISTS idx_calls_intent_fallback_dedupe
  ON public.calls(site_id, matched_session_id, intent_action, intent_target, created_at)
  WHERE source = 'click' AND (status = 'intent' OR status IS NULL);

-- 4) Restore single-card semantics per session for sync pipeline.
CREATE OR REPLACE FUNCTION public.ensure_session_intent_v1(
  p_site_id uuid,
  p_session_id uuid,
  p_fingerprint text,
  p_lead_score integer,
  p_intent_action text,
  p_intent_target text,
  p_intent_page_url text,
  p_click_id text,
  p_form_state text DEFAULT NULL,
  p_form_summary jsonb DEFAULT NULL
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
  v_target text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  IF p_site_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_params', ERRCODE = 'P0001';
  END IF;

  v_stamp := 'session:' || p_session_id::text;
  v_action := lower(coalesce(nullif(trim(p_intent_action), ''), 'phone'));
  IF v_action NOT IN ('phone', 'whatsapp', 'form') THEN
    v_action := 'phone';
  END IF;

  v_target := coalesce(nullif(trim(p_intent_target), ''), 'Unknown');

  INSERT INTO public.calls (
    site_id,
    phone_number,
    matched_session_id,
    matched_fingerprint,
    lead_score,
    lead_score_at_match,
    source,
    status,
    intent_stamp,
    intent_action,
    intent_target,
    intent_page_url,
    click_id,
    form_state,
    form_summary,
    intent_phone_clicks,
    intent_whatsapp_clicks,
    intent_last_at,
    created_at,
    matched_at
  ) VALUES (
    p_site_id,
    left(v_target, 512),
    p_session_id,
    nullif(trim(p_fingerprint), ''),
    coalesce(p_lead_score, 0),
    coalesce(p_lead_score, 0),
    'click',
    'intent',
    v_stamp,
    v_action,
    left(v_target, 512),
    nullif(trim(p_intent_page_url), ''),
    nullif(trim(p_click_id), ''),
    nullif(trim(p_form_state), ''),
    p_form_summary,
    CASE WHEN v_action = 'phone' THEN 1 ELSE 0 END,
    CASE WHEN v_action = 'whatsapp' THEN 1 ELSE 0 END,
    now(),
    now(),
    now()
  )
  ON CONFLICT (site_id, intent_stamp) DO UPDATE
  SET
    status = CASE
      WHEN public.calls.status IS NULL OR public.calls.status = 'intent' THEN 'intent'
      ELSE public.calls.status
    END,
    matched_session_id = coalesce(public.calls.matched_session_id, EXCLUDED.matched_session_id),
    matched_fingerprint = coalesce(public.calls.matched_fingerprint, EXCLUDED.matched_fingerprint),
    lead_score = greatest(coalesce(public.calls.lead_score, 0), coalesce(EXCLUDED.lead_score, 0)),
    lead_score_at_match = greatest(coalesce(public.calls.lead_score_at_match, 0), coalesce(EXCLUDED.lead_score_at_match, 0)),
    intent_action = EXCLUDED.intent_action,
    intent_target = coalesce(EXCLUDED.intent_target, public.calls.intent_target),
    intent_page_url = coalesce(EXCLUDED.intent_page_url, public.calls.intent_page_url),
    click_id = coalesce(EXCLUDED.click_id, public.calls.click_id),
    form_state = coalesce(EXCLUDED.form_state, public.calls.form_state),
    form_summary = coalesce(EXCLUDED.form_summary, public.calls.form_summary),
    intent_phone_clicks = coalesce(public.calls.intent_phone_clicks, 0) + CASE WHEN EXCLUDED.intent_action = 'phone' THEN 1 ELSE 0 END,
    intent_whatsapp_clicks = coalesce(public.calls.intent_whatsapp_clicks, 0) + CASE WHEN EXCLUDED.intent_action = 'whatsapp' THEN 1 ELSE 0 END,
    intent_last_at = now()
  RETURNING public.calls.id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_session_intent_v1(
  uuid, uuid, text, integer, text, text, text, text, text, jsonb
) TO service_role;

COMMIT;
