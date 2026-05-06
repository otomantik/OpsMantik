set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.apply_marketing_signal_dispatch_batch_v1(p_site_id uuid, p_signal_ids uuid[], p_expect_status text, p_new_status text, p_google_sent_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  IF p_signal_ids IS NULL OR COALESCE(array_length(p_signal_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  WITH upd AS (
    UPDATE public.marketing_signals ms
    SET
      dispatch_status = p_new_status,
      google_sent_at = CASE
        WHEN p_google_sent_at IS NOT NULL THEN p_google_sent_at
        ELSE ms.google_sent_at
      END,
      updated_at = now()
    WHERE ms.site_id = p_site_id
      AND ms.id = ANY (p_signal_ids)
      AND ms.dispatch_status = p_expect_status
    RETURNING ms.id
  )
  SELECT count(*)::integer INTO v_count FROM upd;

  RETURN COALESCE(v_count, 0);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.compute_canonical_intent_key_v1(p_site_id uuid, p_matched_session_id uuid, p_intent_action text, p_created_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    'fallback:' || p_site_id::text || ':' ||
    coalesce(p_matched_session_id::text, 'none') || ':' ||
    coalesce(nullif(lower(trim(p_intent_action)), ''), 'unknown') || ':' ||
    to_char(date_trunc('minute', coalesce(p_created_at, now() at time zone 'utc')), 'YYYY-MM-DD"T"HH24:MI');
$function$
;

CREATE OR REPLACE FUNCTION public.get_dashboard_intents(p_site_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_ads_only boolean DEFAULT true, p_only_unreviewed boolean DEFAULT true, p_include_reviewed boolean DEFAULT false)
 RETURNS TABLE(id uuid, type text, "timestamp" timestamp with time zone, status text, sealed_at timestamp with time zone, page_url text, city text, district text, device_type text, matched_session_id uuid, confidence_score numeric, phone_number text, event_category text, event_action text, reviewed_at timestamp with time zone, reviewed_by uuid, dedupe_key text, canonical_intent_key text, duplicate_hint boolean)
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
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
        AND c.status = 'intent'
        AND c.reviewed_at IS NULL
      )
      OR (
        NOT coalesce(p_only_unreviewed, true)
        AND c.status = 'intent'
      )
    )
  ORDER BY c.created_at DESC
  LIMIT 1000;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claims text;
  v_claim_role text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  ) THEN
    RETURN true;
  END IF;

  v_claim_role := lower(coalesce(current_setting('request.jwt.claim.role', true), ''));
  IF v_claim_role IN ('admin', 'super_admin', 'superadmin') THEN
    RETURN true;
  END IF;

  v_claims := current_setting('request.jwt.claims', true);
  IF v_claims IS NOT NULL
     AND lower(coalesce((v_claims::jsonb ->> 'role'), '')) IN ('admin', 'super_admin', 'superadmin') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rescue_marketing_signals_stale_processing_v1(p_cutoff timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  IF p_cutoff IS NULL THEN
    RETURN 0;
  END IF;

  WITH upd AS (
    UPDATE public.marketing_signals ms
    SET
      dispatch_status = 'PENDING',
      updated_at = now()
    WHERE ms.dispatch_status = 'PROCESSING'
      AND ms.updated_at < p_cutoff
    RETURNING ms.id
  )
  SELECT count(*)::integer INTO v_count FROM upd;

  RETURN COALESCE(v_count, 0);
END;
$function$
;


