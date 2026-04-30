-- Intent lifecycle hardening: reviewed flags, canonical dedupe key,
-- state-first queue filters, and duplicate-safe RPC contracts.

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid NULL,
  ADD COLUMN IF NOT EXISTS canonical_intent_key text NULL;

CREATE OR REPLACE FUNCTION public.compute_canonical_intent_key_v1(
  p_site_id uuid,
  p_matched_session_id uuid,
  p_intent_action text,
  p_created_at timestamptz
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT
    'fallback:' || p_site_id::text || ':' ||
    coalesce(p_matched_session_id::text, 'none') || ':' ||
    coalesce(nullif(lower(trim(p_intent_action)), ''), 'unknown') || ':' ||
    to_char(date_trunc('minute', coalesce(p_created_at, timezone('utc', now()))), 'YYYY-MM-DD"T"HH24:MI');
$$;

CREATE OR REPLACE FUNCTION public.calls_set_canonical_intent_key_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.canonical_intent_key IS NULL OR btrim(NEW.canonical_intent_key) = '' THEN
    NEW.canonical_intent_key := public.compute_canonical_intent_key_v1(
      NEW.site_id,
      NEW.matched_session_id,
      NEW.intent_action,
      NEW.created_at
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calls_set_canonical_intent_key_v1 ON public.calls;
CREATE TRIGGER trg_calls_set_canonical_intent_key_v1
BEFORE INSERT OR UPDATE OF canonical_intent_key, matched_session_id, intent_action, created_at
ON public.calls
FOR EACH ROW
EXECUTE FUNCTION public.calls_set_canonical_intent_key_v1();

UPDATE public.calls
SET canonical_intent_key = public.compute_canonical_intent_key_v1(
  site_id,
  matched_session_id,
  intent_action,
  created_at
)
WHERE canonical_intent_key IS NULL OR btrim(canonical_intent_key) = '';

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY site_id, canonical_intent_key
      ORDER BY
        CASE WHEN lower(coalesce(status, '')) IN ('real', 'junk', 'cancelled') THEN 0 ELSE 1 END,
        created_at DESC,
        id
    ) AS rn
  FROM public.calls
  WHERE canonical_intent_key IS NOT NULL
)
UPDATE public.calls c
SET canonical_intent_key = NULL
FROM ranked r
WHERE c.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS calls_site_canonical_intent_key_uniq
ON public.calls(site_id, canonical_intent_key)
WHERE canonical_intent_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.apply_call_action_with_review_v1(
  p_call_id uuid,
  p_site_id uuid,
  p_stage text,
  p_actor_id uuid,
  p_lead_score integer DEFAULT NULL,
  p_version integer DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_reviewed boolean DEFAULT true
)
RETURNS public.calls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.calls;
BEGIN
  SELECT * INTO v_row
  FROM public.apply_call_action_v2(
    p_call_id,
    p_site_id,
    p_stage,
    p_actor_id,
    p_lead_score,
    p_version,
    p_metadata
  )
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'apply_call_action_v2 returned no row';
  END IF;

  UPDATE public.calls c
  SET
    reviewed_at = CASE WHEN coalesce(p_reviewed, true) THEN timezone('utc', now()) ELSE NULL END,
    reviewed_by = CASE WHEN coalesce(p_reviewed, true) THEN p_actor_id ELSE NULL END
  WHERE c.id = p_call_id
    AND c.site_id = p_site_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_recent_intents_lite_v1(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_limit integer DEFAULT 100,
  p_ads_only boolean DEFAULT true,
  p_only_unreviewed boolean DEFAULT true,
  p_include_reviewed boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  version integer,
  created_at timestamptz,
  status text,
  matched_session_id uuid,
  intent_action text,
  intent_target text,
  summary text,
  intent_page_url text,
  page_url text,
  click_id text,
  phone_clicks integer,
  whatsapp_clicks integer,
  intent_events integer,
  traffic_source text,
  traffic_medium text,
  attribution_source text,
  gclid text,
  wbraid text,
  gbraid text,
  utm_term text,
  utm_campaign text,
  utm_source text,
  matchtype text,
  city text,
  district text,
  device_type text,
  device_os text,
  total_duration_sec integer,
  event_count integer,
  reviewed_at timestamptz,
  reviewed_by uuid,
  dedupe_key text,
  canonical_intent_key text,
  duplicate_hint boolean
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.version,
    c.created_at,
    c.status,
    c.matched_session_id,
    CASE
      WHEN coalesce(lower(c.phone_number), '') LIKE '%whatsapp%' THEN 'whatsapp'
      ELSE 'phone'
    END AS intent_action,
    c.phone_number AS intent_target,
    c.phone_number AS summary,
    s.entry_page AS intent_page_url,
    s.entry_page AS page_url,
    coalesce(s.gclid, s.wbraid, s.gbraid) AS click_id,
    0::integer AS phone_clicks,
    0::integer AS whatsapp_clicks,
    1::integer AS intent_events,
    s.traffic_source,
    s.traffic_medium,
    s.attribution_source,
    s.gclid,
    s.wbraid,
    s.gbraid,
    s.utm_term,
    s.utm_campaign,
    s.utm_source,
    s.matchtype,
    s.city,
    s.district,
    s.device_type,
    s.device_os,
    s.total_duration_sec,
    s.event_count,
    c.reviewed_at,
    c.reviewed_by,
    c.canonical_intent_key AS dedupe_key,
    c.canonical_intent_key,
    EXISTS (
      SELECT 1
      FROM public.calls cx
      WHERE cx.site_id = c.site_id
        AND cx.canonical_intent_key IS NOT DISTINCT FROM c.canonical_intent_key
        AND cx.id <> c.id
    ) AS duplicate_hint
  FROM public.calls c
  LEFT JOIN public.sessions s
    ON s.id = c.matched_session_id
   AND s.site_id = c.site_id
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND public._can_access_site(p_site_id)
    AND (NOT coalesce(p_ads_only, true) OR (s.id IS NOT NULL AND public.is_ads_session(s)))
    AND (
      coalesce(p_include_reviewed, false)
      OR (
        (NOT coalesce(p_only_unreviewed, true) AND (c.status IS NULL OR c.status IN ('intent','contacted')))
        OR (
          coalesce(p_only_unreviewed, true)
          AND (c.status IS NULL OR c.status IN ('intent','contacted'))
          AND c.reviewed_at IS NULL
        )
      )
    )
    AND (
      coalesce(p_include_reviewed, false)
      OR NOT EXISTS (
        SELECT 1
        FROM public.calls c2
        WHERE c2.site_id = c.site_id
          AND c2.matched_session_id IS NOT DISTINCT FROM c.matched_session_id
          AND c2.status IN ('junk','cancelled')
      )
    )
  ORDER BY c.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 100), 500));
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_intents(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_ads_only boolean DEFAULT true,
  p_only_unreviewed boolean DEFAULT true,
  p_include_reviewed boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  type text,
  "timestamp" timestamptz,
  status text,
  sealed_at timestamptz,
  page_url text,
  city text,
  district text,
  device_type text,
  matched_session_id uuid,
  confidence_score numeric,
  phone_number text,
  event_category text,
  event_action text,
  reviewed_at timestamptz,
  reviewed_by uuid,
  dedupe_key text,
  canonical_intent_key text,
  duplicate_hint boolean
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    c.id,
    'call'::text AS type,
    c.created_at AS "timestamp",
    c.status,
    c.confirmed_at AS sealed_at,
    s.entry_page AS page_url,
    s.city,
    s.district,
    s.device_type,
    c.matched_session_id,
    coalesce(c.lead_score, 0)::numeric AS confidence_score,
    c.phone_number,
    NULL::text AS event_category,
    NULL::text AS event_action,
    c.reviewed_at,
    c.reviewed_by,
    c.canonical_intent_key AS dedupe_key,
    c.canonical_intent_key,
    EXISTS (
      SELECT 1
      FROM public.calls cx
      WHERE cx.site_id = c.site_id
        AND cx.canonical_intent_key IS NOT DISTINCT FROM c.canonical_intent_key
        AND cx.id <> c.id
    ) AS duplicate_hint
  FROM public.calls c
  LEFT JOIN public.sessions s
    ON s.id = c.matched_session_id
   AND s.site_id = c.site_id
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND public._can_access_site(p_site_id)
    AND (p_status IS NULL OR c.status = p_status)
    AND (
      p_search IS NULL
      OR coalesce(c.phone_number, '') ILIKE ('%' || p_search || '%')
      OR coalesce(s.entry_page, '') ILIKE ('%' || p_search || '%')
    )
    AND (NOT coalesce(p_ads_only, true) OR (s.id IS NOT NULL AND public.is_ads_session(s)))
    AND (
      coalesce(p_include_reviewed, false)
      OR (
        coalesce(p_only_unreviewed, true)
        AND c.status IN ('intent','contacted')
        AND c.reviewed_at IS NULL
      )
      OR (
        NOT coalesce(p_only_unreviewed, true)
        AND c.status IN ('intent','contacted')
      )
    )
  ORDER BY c.created_at DESC
  LIMIT 1000;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_intents(uuid, timestamptz, timestamptz, text, text, boolean, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, integer, boolean, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_call_action_with_review_v1(uuid, uuid, text, uuid, integer, integer, jsonb, boolean) TO authenticated, service_role;

