drop trigger if exists "trg_calls_set_canonical_intent_key_v1" on "public"."calls";

alter table "public"."sites" drop constraint "sites_domain_key";

drop function if exists "public"."apply_call_action_v2"(p_call_id uuid, p_site_id uuid, p_stage text, p_actor_id uuid, p_lead_score integer, p_sale_metadata jsonb, p_version integer, p_metadata jsonb, p_caller_phone_raw text, p_caller_phone_e164 text, p_caller_phone_hash text);

drop function if exists "public"."calls_set_canonical_intent_key_v1"();

drop function if exists "public"."erase_pii_for_identifier"(p_site_id uuid, p_identifier text);

drop function if exists "public"."recover_stuck_marketing_signals"(p_min_age_minutes integer);

drop function if exists "public"."reset_business_data_before_cutoff_v1"(p_cutoff timestamp with time zone, p_site_id uuid);

drop index if exists "public"."sites_domain_key";

CREATE UNIQUE INDEX sites_domain_key ON public.sites USING btree (domain) WHERE (domain IS NOT NULL);

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.apply_call_action_with_review_v1(p_call_id uuid, p_site_id uuid, p_stage text, p_actor_id uuid, p_lead_score integer DEFAULT NULL::integer, p_version integer DEFAULT NULL::integer, p_metadata jsonb DEFAULT '{}'::jsonb, p_reviewed boolean DEFAULT true, p_caller_phone_raw text DEFAULT NULL::text, p_caller_phone_e164 text DEFAULT NULL::text, p_caller_phone_hash text DEFAULT NULL::text)
 RETURNS public.calls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    RAISE EXCEPTION 'apply_call_action_v2 returned no row or version mismatch';
  END IF;

  UPDATE public.calls c
  SET
    reviewed_at = CASE WHEN coalesce(p_reviewed, true) THEN timezone('utc', now()) ELSE NULL END,
    reviewed_by = CASE WHEN coalesce(p_reviewed, true) THEN p_actor_id ELSE NULL END
  WHERE c.id = p_call_id
    AND c.site_id = p_site_id
  RETURNING * INTO v_row;

  BEGIN
    UPDATE public.calls c
    SET
      caller_phone_raw = coalesce(nullif(trim(p_caller_phone_raw), ''), c.caller_phone_raw),
      caller_phone_e164 = coalesce(nullif(trim(p_caller_phone_e164), ''), c.caller_phone_e164),
      caller_phone_hash = coalesce(nullif(trim(p_caller_phone_hash), ''), c.caller_phone_hash)
    WHERE c.id = p_call_id
      AND c.site_id = p_site_id
    RETURNING * INTO v_row;
  EXCEPTION
    WHEN undefined_column THEN
      NULL;
  END;

  RETURN v_row;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_call_action_v2(p_call_id uuid, p_site_id uuid, p_stage text, p_actor_id uuid, p_lead_score integer DEFAULT NULL::integer, p_version integer DEFAULT NULL::integer, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS public.calls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.calls;
  v_target_status text;
BEGIN
  IF p_call_id IS NULL OR p_site_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_params', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row
  FROM public.calls c
  WHERE c.id = p_call_id
    AND c.site_id = p_site_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'call_not_found', ERRCODE = 'P0001';
  END IF;

  IF p_version IS NOT NULL AND coalesce(v_row.version, 0) <> p_version THEN
    RAISE EXCEPTION USING MESSAGE = 'version_conflict', ERRCODE = '40900';
  END IF;

  v_target_status := lower(coalesce(nullif(trim(p_stage), ''), 'intent'));
  IF v_target_status NOT IN ('intent', 'contacted', 'offered', 'won', 'confirmed', 'junk', 'cancelled') THEN
    v_target_status := 'intent';
  END IF;

  UPDATE public.calls c
  SET
    status = v_target_status,
    lead_score = coalesce(p_lead_score, c.lead_score),
    version = coalesce(c.version, 0) + 1
  WHERE c.id = p_call_id
    AND c.site_id = p_site_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.compute_canonical_intent_key_v1(p_site_id uuid, p_matched_session_id uuid, p_intent_action text, p_created_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
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

CREATE OR REPLACE FUNCTION public.get_intent_details_v1(p_site_id uuid, p_call_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  SELECT to_jsonb(t)
  FROM (
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
      s.entry_page AS intent_page_url,
      s.entry_page AS page_url,
      coalesce(s.gclid, s.wbraid, s.gbraid) AS click_id,
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
      s.event_count
    FROM public.calls c
    LEFT JOIN public.sessions s
      ON s.id = c.matched_session_id
     AND s.site_id = c.site_id
    WHERE c.site_id = p_site_id
      AND c.id = p_call_id
      AND public._can_access_site(p_site_id)
    LIMIT 1
  ) t;
$function$
;

CREATE OR REPLACE FUNCTION public.get_recent_intents_lite_v1(p_site_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_limit integer DEFAULT 100, p_ads_only boolean DEFAULT true)
 RETURNS TABLE(id uuid, version integer, created_at timestamp with time zone, status text, matched_session_id uuid, intent_action text, intent_target text, summary text, intent_page_url text, page_url text, click_id text, phone_clicks integer, whatsapp_clicks integer, intent_events integer, traffic_source text, traffic_medium text, attribution_source text, gclid text, wbraid text, gbraid text, utm_term text, utm_campaign text, utm_source text, matchtype text, city text, district text, device_type text, device_os text, total_duration_sec integer, event_count integer)
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
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
    s.event_count
  FROM public.calls c
  LEFT JOIN public.sessions s
    ON s.id = c.matched_session_id
   AND s.site_id = c.site_id
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND public._can_access_site(p_site_id)
    AND (NOT coalesce(p_ads_only, true) OR (s.id IS NOT NULL AND public.is_ads_session(s)))
    AND (c.status IS NULL OR c.status = 'intent')
    AND NOT EXISTS (
      SELECT 1
      FROM public.calls c2
      WHERE c2.site_id = c.site_id
        AND c2.matched_session_id IS NOT DISTINCT FROM c.matched_session_id
        AND c2.status IN ('junk','cancelled')
    )
  ORDER BY c.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 100), 500));
$function$
;

CREATE OR REPLACE FUNCTION public.get_recent_intents_v1(p_site_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_minutes_lookback integer DEFAULT 60, p_limit integer DEFAULT 100, p_ads_only boolean DEFAULT true)
 RETURNS TABLE(id uuid, version integer, created_at timestamp with time zone, status text, matched_session_id uuid, intent_action text, intent_target text, summary text, page_url text, click_id text)
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  WITH bounds AS (
    SELECT coalesce(p_since, now() - make_interval(mins => GREATEST(1, coalesce(p_minutes_lookback, 60)))) AS since_at
  )
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
    s.entry_page AS page_url,
    coalesce(s.gclid, s.wbraid, s.gbraid) AS click_id
  FROM public.calls c
  LEFT JOIN public.sessions s
    ON s.id = c.matched_session_id
   AND s.site_id = c.site_id
  CROSS JOIN bounds b
  WHERE c.site_id = p_site_id
    AND c.created_at >= b.since_at
    AND public._can_access_site(p_site_id)
    AND (NOT coalesce(p_ads_only, true) OR (s.id IS NOT NULL AND public.is_ads_session(s)))
  ORDER BY c.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 100), 500));
$function$
;

CREATE OR REPLACE FUNCTION public.get_recent_intents_v2(p_site_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_limit integer DEFAULT 100, p_ads_only boolean DEFAULT true)
 RETURNS TABLE(id uuid, version integer, created_at timestamp with time zone, status text, matched_session_id uuid, intent_action text, intent_target text, summary text, page_url text, click_id text, city text, district text, device_type text, device_os text, attribution_source text, traffic_source text, traffic_medium text, gclid text, wbraid text, gbraid text, utm_term text, utm_campaign text, utm_source text, matchtype text, total_duration_sec integer, event_count integer)
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
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
    s.entry_page AS page_url,
    coalesce(s.gclid, s.wbraid, s.gbraid) AS click_id,
    s.city,
    s.district,
    s.device_type,
    s.device_os,
    s.attribution_source,
    s.traffic_source,
    s.traffic_medium,
    s.gclid,
    s.wbraid,
    s.gbraid,
    s.utm_term,
    s.utm_campaign,
    s.utm_source,
    s.matchtype,
    s.total_duration_sec,
    s.event_count
  FROM public.calls c
  LEFT JOIN public.sessions s
    ON s.id = c.matched_session_id
   AND s.site_id = c.site_id
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND public._can_access_site(p_site_id)
    AND (NOT coalesce(p_ads_only, true) OR (s.id IS NOT NULL AND public.is_ads_session(s)))
  ORDER BY c.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 100), 500));
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

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


