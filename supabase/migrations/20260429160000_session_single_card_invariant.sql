BEGIN;

-- 1) Audit-preserving merge metadata for historical duplicate cleanup.
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS merged_into_call_id uuid NULL,
  ADD COLUMN IF NOT EXISTS merged_reason text NULL;

-- 2) Append-only ledger for intent action history.
CREATE TABLE IF NOT EXISTS public.session_intent_actions_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  session_id uuid NOT NULL,
  call_id uuid NULL REFERENCES public.calls(id) ON DELETE SET NULL,
  intent_action text NOT NULL,
  intent_target text NULL,
  intent_page_url text NULL,
  source text NOT NULL DEFAULT 'unknown',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_intent_actions_ledger_site_session_created
  ON public.session_intent_actions_ledger(site_id, session_id, created_at DESC);

-- 3) Canonicalize click intent stamps at the table boundary.
CREATE OR REPLACE FUNCTION public.calls_click_intent_stamp_canonicalize_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source = 'click' THEN
    -- Archival/merged rows must keep their own intent_stamp (e.g. merged:{id})
    -- otherwise canonicalization would push them back to session:{sid} and
    -- violate calls_site_intent_stamp_uniq during cleanup.
    IF NEW.merged_into_call_id IS NOT NULL OR (NEW.merged_reason IS NOT NULL AND btrim(NEW.merged_reason) <> '') THEN
      IF NEW.intent_stamp IS NULL OR btrim(NEW.intent_stamp) = '' THEN
        NEW.intent_stamp := 'merged:' || coalesce(NEW.id::text, gen_random_uuid()::text);
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.matched_session_id IS NOT NULL THEN
      NEW.intent_stamp := 'session:' || NEW.matched_session_id::text;
    ELSIF NEW.intent_stamp IS NULL OR btrim(NEW.intent_stamp) = '' THEN
      -- Conservative null-session fallback; avoids broad cross-user collapsing.
      NEW.intent_stamp := 'fallback:' || substr(
        md5(
          coalesce(NEW.site_id::text, '') || '|' ||
          coalesce(NEW.matched_fingerprint, '') || '|' ||
          coalesce(NEW.intent_target, '') || '|' ||
          coalesce(NEW.phone_number, '')
        ),
        1,
        24
      );
    END IF;

    IF NEW.intent_last_at IS NULL THEN
      NEW.intent_last_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calls_click_intent_stamp_canonicalize_v1 ON public.calls;
CREATE TRIGGER trg_calls_click_intent_stamp_canonicalize_v1
BEFORE INSERT OR UPDATE OF source, matched_session_id, intent_stamp, intent_target, matched_fingerprint, phone_number
ON public.calls
FOR EACH ROW
EXECUTE FUNCTION public.calls_click_intent_stamp_canonicalize_v1();

-- 4) Deterministic historical duplicate cleanup (per site_id + matched_session_id, click rows).
WITH ranked AS (
  SELECT
    c.id,
    c.site_id,
    c.matched_session_id,
    c.status,
    c.created_at,
    c.intent_action,
    c.intent_target,
    c.intent_page_url,
    (
      CASE lower(coalesce(c.status, 'intent'))
        WHEN 'won' THEN 100
        WHEN 'confirmed' THEN 90
        WHEN 'offered' THEN 80
        WHEN 'contacted' THEN 70
        WHEN 'intent' THEN 60
        WHEN 'junk' THEN 20
        WHEN 'cancelled' THEN 10
        ELSE 50
      END
    ) AS state_rank,
    (
      CASE WHEN c.intent_action IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN c.intent_target IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN c.intent_page_url IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN c.click_id IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN c.gclid IS NOT NULL OR c.wbraid IS NOT NULL OR c.gbraid IS NOT NULL THEN 1 ELSE 0 END
    ) AS richness_rank,
    row_number() OVER (
      PARTITION BY c.site_id, c.matched_session_id
      ORDER BY
        (
          CASE lower(coalesce(c.status, 'intent'))
            WHEN 'won' THEN 100
            WHEN 'confirmed' THEN 90
            WHEN 'offered' THEN 80
            WHEN 'contacted' THEN 70
            WHEN 'intent' THEN 60
            WHEN 'junk' THEN 20
            WHEN 'cancelled' THEN 10
            ELSE 50
          END
        ) DESC,
        c.created_at DESC NULLS LAST,
        (
          CASE WHEN c.intent_action IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN c.intent_target IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN c.intent_page_url IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN c.click_id IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN c.gclid IS NOT NULL OR c.wbraid IS NOT NULL OR c.gbraid IS NOT NULL THEN 1 ELSE 0 END
        ) DESC,
        c.id DESC
    ) AS rn
  FROM public.calls c
  WHERE c.source = 'click'
    AND c.matched_session_id IS NOT NULL
),
losers AS (
  SELECT r.id, r.site_id, r.matched_session_id
  FROM ranked r
  WHERE r.rn > 1
),
survivors AS (
  SELECT r.id, r.site_id, r.matched_session_id
  FROM ranked r
  WHERE r.rn = 1
),
loser_with_survivor AS (
  SELECT l.id AS loser_id, s.id AS survivor_id
  FROM losers l
  JOIN survivors s
    ON s.site_id = l.site_id
   AND s.matched_session_id = l.matched_session_id
)
UPDATE public.calls c
SET
  status = CASE
    WHEN lower(coalesce(c.status, 'intent')) IN ('won', 'confirmed') THEN c.status
    ELSE 'cancelled'
  END,
  merged_into_call_id = lws.survivor_id,
  merged_reason = 'session_single_card_cleanup_v1',
  note = CASE
    WHEN c.note IS NULL OR btrim(c.note) = '' THEN '[merged_into:' || lws.survivor_id::text || ']'
    ELSE c.note || E'\n[merged_into:' || lws.survivor_id::text || ']'
  END,
  intent_stamp = 'merged:' || c.id::text
FROM loser_with_survivor lws
WHERE c.id = lws.loser_id;

-- Canonical stamp for all known-session click rows after loser archival.
UPDATE public.calls c
SET intent_stamp = 'session:' || c.matched_session_id::text
WHERE c.source = 'click'
  AND c.matched_session_id IS NOT NULL
  AND (
    c.intent_stamp IS NULL
    OR c.intent_stamp <> ('session:' || c.matched_session_id::text)
  )
  AND (c.merged_into_call_id IS NULL OR c.id = c.merged_into_call_id);

-- 5) Authoritative RPC: lock + field-level merge + ledger append.
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

  -- Prevent concurrent write contention for same site+session.
  PERFORM pg_advisory_xact_lock(hashtext(p_site_id::text || ':' || p_session_id::text));

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
    -- Preserve stronger states; intent writes must not downgrade sealed/confirmed rows.
    status = CASE
      WHEN lower(coalesce(public.calls.status, 'intent')) IN ('won', 'confirmed', 'offered', 'contacted') THEN public.calls.status
      WHEN public.calls.status IS NULL OR public.calls.status = 'intent' THEN 'intent'
      ELSE public.calls.status
    END,
    matched_session_id = coalesce(public.calls.matched_session_id, EXCLUDED.matched_session_id),
    matched_fingerprint = coalesce(public.calls.matched_fingerprint, EXCLUDED.matched_fingerprint),
    lead_score = greatest(coalesce(public.calls.lead_score, 0), coalesce(EXCLUDED.lead_score, 0)),
    lead_score_at_match = greatest(coalesce(public.calls.lead_score_at_match, 0), coalesce(EXCLUDED.lead_score_at_match, 0)),
    -- Field-level merge contract
    intent_action = CASE
      WHEN lower(coalesce(public.calls.status, 'intent')) IN ('won', 'confirmed') THEN public.calls.intent_action
      ELSE coalesce(nullif(EXCLUDED.intent_action, ''), public.calls.intent_action)
    END,
    intent_target = coalesce(nullif(EXCLUDED.intent_target, ''), public.calls.intent_target),
    intent_page_url = coalesce(nullif(EXCLUDED.intent_page_url, ''), public.calls.intent_page_url),
    click_id = coalesce(nullif(EXCLUDED.click_id, ''), public.calls.click_id),
    form_state = coalesce(nullif(EXCLUDED.form_state, ''), public.calls.form_state),
    form_summary = coalesce(EXCLUDED.form_summary, public.calls.form_summary),
    intent_phone_clicks = coalesce(public.calls.intent_phone_clicks, 0) + CASE WHEN EXCLUDED.intent_action = 'phone' THEN 1 ELSE 0 END,
    intent_whatsapp_clicks = coalesce(public.calls.intent_whatsapp_clicks, 0) + CASE WHEN EXCLUDED.intent_action = 'whatsapp' THEN 1 ELSE 0 END,
    intent_last_at = now()
  RETURNING public.calls.id INTO v_id;

  INSERT INTO public.session_intent_actions_ledger(
    site_id,
    session_id,
    call_id,
    intent_action,
    intent_target,
    intent_page_url,
    source,
    metadata
  ) VALUES (
    p_site_id,
    p_session_id,
    v_id,
    v_action,
    left(v_target, 512),
    nullif(trim(p_intent_page_url), ''),
    'ensure_session_intent_v1',
    jsonb_build_object(
      'click_id', nullif(trim(p_click_id), ''),
      'lead_score', coalesce(p_lead_score, 0),
      'form_state', nullif(trim(p_form_state), '')
    )
  );

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_session_intent_v1(
  uuid, uuid, text, integer, text, text, text, text, text, jsonb
) TO service_role;

-- 6) Invariant assertion: no more than one active click-intent card per known session.
DO $$
DECLARE
  v_duplicates bigint;
BEGIN
  SELECT count(*)
  INTO v_duplicates
  FROM (
    SELECT c.site_id, c.matched_session_id
    FROM public.calls c
    WHERE c.source = 'click'
      AND c.matched_session_id IS NOT NULL
      AND lower(coalesce(c.status, 'intent')) IN ('intent', 'contacted', 'offered', 'won', 'confirmed')
    GROUP BY c.site_id, c.matched_session_id
    HAVING count(*) > 1
  ) dup;

  IF coalesce(v_duplicates, 0) > 0 THEN
    RAISE EXCEPTION 'session_single_card_invariant_failed: % duplicate groups remain', v_duplicates;
  END IF;
END $$;

COMMIT;
