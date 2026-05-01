BEGIN;

CREATE OR REPLACE FUNCTION public.find_or_reuse_session_v1(
  p_site_id uuid,
  p_primary_click_id text,
  p_intent_action text,
  p_normalized_intent_target text,
  p_occurred_at timestamptz DEFAULT now(),
  p_candidate_session_id uuid DEFAULT NULL,
  p_proposed_session_id uuid DEFAULT NULL,
  p_fingerprint text DEFAULT NULL,
  p_entry_page text DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_gclid text DEFAULT NULL,
  p_wbraid text DEFAULT NULL,
  p_gbraid text DEFAULT NULL,
  p_attribution_source text DEFAULT NULL,
  p_traffic_source text DEFAULT NULL,
  p_traffic_medium text DEFAULT NULL,
  p_device_type text DEFAULT NULL,
  p_device_os text DEFAULT NULL
)
RETURNS TABLE (
  matched_session_id uuid,
  matched_session_month date,
  reused boolean,
  reason text,
  candidate_session_id uuid,
  time_delta_ms integer,
  lifecycle_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key text;
  v_action text := lower(coalesce(nullif(trim(p_intent_action), ''), 'unknown'));
  v_target text := coalesce(nullif(trim(p_normalized_intent_target), ''), '');
  v_now timestamptz := coalesce(p_occurred_at, now());
  v_found record;
  v_created_session_id uuid;
  v_created_month date := date_trunc('month', timezone('utc', now()))::date;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;
  IF p_site_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_params:site_id', ERRCODE = 'P0001';
  END IF;

  v_lock_key := coalesce(p_site_id::text, '') || '|' || coalesce(p_primary_click_id, '') || '|' || v_action || '|' || v_target;
  PERFORM pg_advisory_xact_lock(hashtext(v_lock_key));

  IF p_primary_click_id IS NOT NULL
     AND btrim(p_primary_click_id) <> ''
     AND v_action IN ('phone', 'whatsapp', 'form')
     AND v_target <> '' THEN
    SELECT
      c.matched_session_id AS sid,
      s.created_month AS smonth,
      lower(coalesce(c.status, 'intent')) AS lifecycle,
      abs(extract(epoch FROM (v_now - c.created_at)) * 1000)::integer AS delta_ms
    INTO v_found
    FROM public.calls c
    JOIN public.sessions s
      ON s.id = c.matched_session_id
     AND s.site_id = c.site_id
    WHERE c.site_id = p_site_id
      AND c.matched_session_id IS NOT NULL
      AND lower(coalesce(c.intent_action, '')) = v_action
      AND coalesce(c.intent_target, '') = v_target
      AND coalesce(c.gclid, c.wbraid, c.gbraid) = p_primary_click_id
      AND lower(coalesce(c.status, 'intent')) IN ('intent', 'contacted', 'offered')
      AND c.merged_into_call_id IS NULL
      AND abs(extract(epoch FROM (v_now - c.created_at))) <= 90
    ORDER BY abs(extract(epoch FROM (v_now - c.created_at))) ASC, c.created_at DESC
    LIMIT 1;
  END IF;

  IF v_found.sid IS NOT NULL THEN
    RETURN QUERY
    SELECT v_found.sid, v_found.smonth, true, 'reused_existing_active_signal', v_found.sid, v_found.delta_ms, v_found.lifecycle;
    RETURN;
  END IF;

  IF p_candidate_session_id IS NOT NULL THEN
    RETURN QUERY
    SELECT s.id, s.created_month, false, 'fallback_candidate_session', p_candidate_session_id, NULL::integer, NULL::text
    FROM public.sessions s
    WHERE s.id = p_candidate_session_id
      AND s.site_id = p_site_id
    LIMIT 1;
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  v_created_session_id := coalesce(p_proposed_session_id, gen_random_uuid());

  INSERT INTO public.sessions (
    id,
    site_id,
    created_month,
    entry_page,
    ip_address,
    fingerprint,
    gclid,
    wbraid,
    gbraid,
    attribution_source,
    traffic_source,
    traffic_medium,
    device_type,
    device_os
  )
  VALUES (
    v_created_session_id,
    p_site_id,
    v_created_month,
    nullif(trim(coalesce(p_entry_page, '')), ''),
    nullif(trim(coalesce(p_ip_address, '')), ''),
    nullif(trim(coalesce(p_fingerprint, '')), ''),
    nullif(trim(coalesce(p_gclid, '')), ''),
    nullif(trim(coalesce(p_wbraid, '')), ''),
    nullif(trim(coalesce(p_gbraid, '')), ''),
    nullif(trim(coalesce(p_attribution_source, '')), ''),
    nullif(trim(coalesce(p_traffic_source, '')), ''),
    nullif(trim(coalesce(p_traffic_medium, '')), ''),
    nullif(trim(coalesce(p_device_type, '')), ''),
    nullif(trim(coalesce(p_device_os, '')), '')
  )
  ON CONFLICT (id) DO UPDATE
  SET updated_at = timezone('utc', now())
  RETURNING id, created_month
  INTO matched_session_id, matched_session_month;

  reused := false;
  reason := 'created_new_session';
  candidate_session_id := matched_session_id;
  time_delta_ms := NULL;
  lifecycle_status := NULL;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.find_or_reuse_session_v1(
  uuid, text, text, text, timestamptz, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_reuse_session_v1(
  uuid, text, text, text, timestamptz, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text
) TO service_role;

-- Validation block 1: active duplicate validation.
DO $$
DECLARE
  v_dup_count bigint;
BEGIN
  SELECT count(*)
  INTO v_dup_count
  FROM (
    SELECT c.site_id, c.intent_stamp
    FROM public.calls c
    WHERE lower(coalesce(c.status, 'intent')) IN ('intent', 'contacted', 'offered')
      AND c.intent_stamp IS NOT NULL
    GROUP BY c.site_id, c.intent_stamp
    HAVING count(*) > 1
  ) d;
  IF coalesce(v_dup_count, 0) > 0 THEN
    RAISE EXCEPTION 'active duplicate validation failed: % duplicate active stamp groups', v_dup_count;
  END IF;
END $$;

-- Validation block 2: intent_stamp canonicalization validation.
DO $$
DECLARE
  v_noncanonical bigint;
BEGIN
  SELECT count(*)
  INTO v_noncanonical
  FROM public.calls c
  WHERE lower(coalesce(c.status, 'intent')) IN ('intent', 'contacted', 'offered')
    AND c.matched_session_id IS NOT NULL
    AND c.source = 'click'
    AND c.intent_stamp IS DISTINCT FROM ('session:' || c.matched_session_id::text)
    AND c.merged_into_call_id IS NULL;
  IF coalesce(v_noncanonical, 0) > 0 THEN
    RAISE EXCEPTION 'intent_stamp canonicalization validation failed: % non-canonical active rows', v_noncanonical;
  END IF;
END $$;

-- Validation block 3: merged/archive duplicate cleanup validation.
DO $$
DECLARE
  v_bad_merged bigint;
BEGIN
  SELECT count(*)
  INTO v_bad_merged
  FROM public.calls c
  WHERE c.merged_into_call_id IS NOT NULL
    AND lower(coalesce(c.status, '')) IN ('intent', 'contacted', 'offered');
  IF coalesce(v_bad_merged, 0) > 0 THEN
    RAISE EXCEPTION 'merged/archive cleanup validation failed: % merged rows still active', v_bad_merged;
  END IF;
END $$;

-- Validation block 4: active_session_single_card_guard validation.
DO $$
DECLARE
  v_dup_sessions bigint;
BEGIN
  SELECT count(*)
  INTO v_dup_sessions
  FROM (
    SELECT c.site_id, c.matched_session_id
    FROM public.calls c
    WHERE c.source = 'click'
      AND c.matched_session_id IS NOT NULL
      AND lower(coalesce(c.status, 'intent')) IN ('intent', 'contacted', 'offered')
      AND c.merged_into_call_id IS NULL
    GROUP BY c.site_id, c.matched_session_id
    HAVING count(*) > 1
  ) s;
  IF coalesce(v_dup_sessions, 0) > 0 THEN
    RAISE EXCEPTION 'active_session_single_card_guard validation failed: % duplicate session groups', v_dup_sessions;
  END IF;
END $$;

COMMIT;

