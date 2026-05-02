BEGIN;

-- Coalesce duplicate sessions from parallel ingest (sync vs call-event, missing click-id, split paths).
-- Markers reused_recent_fingerprint_burst / reused_recent_ip_entry_burst consumed by SessionService burst gate.
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
  v_created_month date := date_trunc('month', v_now)::date;
  v_fp_burst_sid uuid;
  v_fp_burst_month date;
  v_fp_burst_delta_ms integer;
  v_ip_burst_sid uuid;
  v_ip_burst_month date;
  v_ip_burst_delta_ms integer;
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
    SELECT v_found.sid, v_found.smonth, true, 'reused_existing_active_signal'::text, v_found.sid, v_found.delta_ms, v_found.lifecycle;
    RETURN;
  END IF;

  -- Fingerprint burst: same visitor within seconds (different advisory lock keys split the click-chain path).
  IF v_action IN ('phone', 'whatsapp', 'form')
     AND p_fingerprint IS NOT NULL
     AND btrim(p_fingerprint) <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('fpburst:' || p_site_id::text || ':' || btrim(p_fingerprint)));

    v_fp_burst_sid := NULL;
    v_fp_burst_month := NULL;
    v_fp_burst_delta_ms := NULL;

    SELECT
      s.id,
      s.created_month,
      abs(extract(epoch FROM (v_now - s.created_at)) * 1000)::integer
    INTO v_fp_burst_sid, v_fp_burst_month, v_fp_burst_delta_ms
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND nullif(btrim(s.fingerprint), '') = nullif(btrim(p_fingerprint), '')
      AND s.created_month IN (
        date_trunc('month', v_now)::date,
        date_trunc('month', v_now - interval '5 seconds')::date
      )
      AND abs(extract(epoch FROM (v_now - s.created_at))) <= 4
    ORDER BY s.created_at DESC
    LIMIT 1;

    IF FOUND AND v_fp_burst_sid IS NOT NULL THEN
      RETURN QUERY
      SELECT v_fp_burst_sid, v_fp_burst_month, true, 'reused_recent_fingerprint_burst'::text, v_fp_burst_sid,
             v_fp_burst_delta_ms, NULL::text;
      RETURN;
    END IF;
  END IF;

  -- IP + entry_page burst (~1s): twin without fingerprint shortly after enriched session creation.
  IF v_action IN ('phone', 'whatsapp', 'form')
     AND p_ip_address IS NOT NULL
     AND btrim(p_ip_address) <> ''
     AND p_entry_page IS NOT NULL
     AND btrim(p_entry_page) <> '' THEN
    PERFORM pg_advisory_xact_lock(
      hashtext('ipentryburst:' || p_site_id::text || ':' || btrim(p_ip_address) || ':' || md5(btrim(p_entry_page)))
    );

    v_ip_burst_sid := NULL;
    v_ip_burst_month := NULL;
    v_ip_burst_delta_ms := NULL;

    SELECT
      s.id,
      s.created_month,
      abs(extract(epoch FROM (v_now - s.created_at)) * 1000)::integer
    INTO v_ip_burst_sid, v_ip_burst_month, v_ip_burst_delta_ms
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND nullif(btrim(s.ip_address), '') = nullif(btrim(p_ip_address), '')
      AND coalesce(nullif(btrim(s.entry_page), ''), chr(1)) = coalesce(nullif(btrim(p_entry_page), ''), chr(1))
      AND s.created_month IN (
        date_trunc('month', v_now)::date,
        date_trunc('month', v_now - interval '5 seconds')::date
      )
      AND abs(extract(epoch FROM (v_now - s.created_at)) * 1000) <= 900
    ORDER BY s.created_at DESC
    LIMIT 1;

    IF FOUND AND v_ip_burst_sid IS NOT NULL THEN
      RETURN QUERY
      SELECT v_ip_burst_sid, v_ip_burst_month, true, 'reused_recent_ip_entry_burst'::text, v_ip_burst_sid,
             v_ip_burst_delta_ms, NULL::text;
      RETURN;
    END IF;
  END IF;

  IF p_candidate_session_id IS NOT NULL THEN
    RETURN QUERY
    SELECT s.id, s.created_month, false, 'fallback_candidate_session'::text, p_candidate_session_id, NULL::integer, NULL::text
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

COMMIT;
