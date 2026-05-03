BEGIN;

-- Cross-format phone intent dedupe (tel:+90… vs +90…) + burst twin merge at DB boundary.
-- Companion to app-side normalizePhoneTarget; locks duplicate "double fire" rows permanently.

CREATE OR REPLACE FUNCTION public.click_intent_burst_match_key_v1(p_raw text, p_action text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(nullif(trim(p_action), ''))
    WHEN 'phone' THEN
      CASE
        WHEN nullif(trim(p_raw), '') IS NULL THEN NULL::text
        WHEN length(
          regexp_replace(
            regexp_replace(lower(trim(p_raw)), '^tel:', '', 'i'),
            '\D', '', 'g'
          )
        ) >= 8
        THEN
          'phone:'
          || regexp_replace(
               regexp_replace(lower(trim(p_raw)), '^tel:', '', 'i'),
               '\D', '', 'g'
             )
        ELSE NULL::text
      END
    WHEN 'whatsapp' THEN
      CASE
        WHEN nullif(trim(p_raw), '') IS NULL THEN NULL::text
        WHEN lower(trim(p_raw)) LIKE 'whatsapp:%'
          AND length(
            regexp_replace(
              regexp_replace(lower(trim(p_raw)), '^whatsapp:', '', 'i'),
              '\D', '', 'g'
            )
          ) >= 8
        THEN
          'wa:'
          || regexp_replace(
               regexp_replace(lower(trim(p_raw)), '^whatsapp:', '', 'i'),
               '\D', '', 'g'
             )
        WHEN length(regexp_replace(lower(trim(p_raw)), '\D', '', 'g')) >= 8
        THEN 'wa:' || regexp_replace(lower(trim(p_raw)), '\D', '', 'g')
        ELSE NULL::text
      END
    ELSE NULL::text
  END
$$;

REVOKE ALL ON FUNCTION public.click_intent_burst_match_key_v1(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.click_intent_burst_match_key_v1(text, text) TO service_role;

-- Normalize tel: URI to +digits before intent_stamp canonicalization (trigger name sorts before click_intent_stamp).
CREATE OR REPLACE FUNCTION public.calls_normalize_tel_uri_phone_click_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src text;
  d text;
BEGIN
  IF NEW.source IS DISTINCT FROM 'click' THEN
    RETURN NEW;
  END IF;
  IF NEW.merged_into_call_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF lower(coalesce(NEW.intent_action, '')) IS DISTINCT FROM 'phone' THEN
    RETURN NEW;
  END IF;

  v_src := coalesce(nullif(btrim(NEW.phone_number), ''), nullif(btrim(NEW.intent_target), ''));
  IF v_src IS NULL OR v_src !~* '^tel:' THEN
    RETURN NEW;
  END IF;

  d := regexp_replace(substring(v_src from 5), '\D', '', 'g');
  IF length(d) < 8 THEN
    RETURN NEW;
  END IF;

  NEW.phone_number := '+' || d;
  NEW.intent_target := NEW.phone_number;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calls_00_normalize_tel_uri_phone_click_v1 ON public.calls;
CREATE TRIGGER trg_calls_00_normalize_tel_uri_phone_click_v1
BEFORE INSERT OR UPDATE OF phone_number, intent_target, intent_action, source
ON public.calls
FOR EACH ROW
EXECUTE FUNCTION public.calls_normalize_tel_uri_phone_click_v1();

-- After insert: if a twin burst exists (same match key, ≤10s), merge loser into survivor (prefer + over tel:, else first click).
CREATE OR REPLACE FUNCTION public.calls_merge_cross_session_burst_twin_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  k text;
  peer_id uuid;
  peer_created timestamptz;
  peer_phone text;
  survivor uuid;
  loser uuid;
BEGIN
  IF NEW.source IS DISTINCT FROM 'click' THEN
    RETURN NEW;
  END IF;
  IF NEW.merged_into_call_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF lower(coalesce(NEW.status, 'intent')) NOT IN ('intent', 'contacted', 'offered') THEN
    RETURN NEW;
  END IF;

  v_action := lower(coalesce(NEW.intent_action, 'phone'));
  IF v_action NOT IN ('phone', 'whatsapp') THEN
    RETURN NEW;
  END IF;

  k := public.click_intent_burst_match_key_v1(
    coalesce(nullif(btrim(NEW.phone_number), ''), nullif(btrim(NEW.intent_target), '')),
    v_action
  );
  IF k IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.site_id::text || '|' || k));

  SELECT c.id, c.created_at, c.phone_number
  INTO peer_id, peer_created, peer_phone
  FROM public.calls c
  WHERE c.site_id = NEW.site_id
    AND c.id IS DISTINCT FROM NEW.id
    AND c.source = 'click'
    AND c.merged_into_call_id IS NULL
    AND lower(coalesce(c.status, 'intent')) IN ('intent', 'contacted', 'offered')
    AND lower(coalesce(c.intent_action, 'phone')) = v_action
    AND public.click_intent_burst_match_key_v1(
          coalesce(nullif(btrim(c.phone_number), ''), nullif(btrim(c.intent_target), '')),
          v_action
        ) IS NOT DISTINCT FROM k
    AND abs(extract(epoch FROM (NEW.created_at - c.created_at))) <= 10
  ORDER BY c.created_at ASC, c.id ASC
  LIMIT 1;

  IF peer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.phone_number IS NOT NULL AND NEW.phone_number ILIKE 'tel:%'
     AND peer_phone IS NOT NULL AND peer_phone NOT ILIKE 'tel:%' THEN
    survivor := peer_id;
    loser := NEW.id;
  ELSIF peer_phone IS NOT NULL AND peer_phone ILIKE 'tel:%'
     AND NEW.phone_number IS NOT NULL AND NEW.phone_number NOT ILIKE 'tel:%' THEN
    survivor := NEW.id;
    loser := peer_id;
  ELSIF NEW.created_at < peer_created OR (NEW.created_at = peer_created AND NEW.id < peer_id) THEN
    survivor := NEW.id;
    loser := peer_id;
  ELSE
    survivor := peer_id;
    loser := NEW.id;
  END IF;

  IF loser = NEW.id THEN
    UPDATE public.calls c
    SET
      status = CASE
        WHEN lower(coalesce(c.status, 'intent')) IN ('won', 'confirmed') THEN c.status
        ELSE 'cancelled'
      END,
      merged_into_call_id = survivor,
      merged_reason = 'cross_session_burst_twin_merge_v1',
      note = CASE
        WHEN c.note IS NULL OR btrim(c.note) = '' THEN '[merged_into_burst_twin:' || survivor::text || ']'
        ELSE c.note || E'\n[merged_into_burst_twin:' || survivor::text || ']'
      END,
      intent_stamp = 'merged:' || c.id::text,
      version = coalesce(c.version, 0) + 1
    WHERE c.id = loser
      AND c.merged_into_call_id IS NULL;
  ELSE
    UPDATE public.calls c
    SET
      status = CASE
        WHEN lower(coalesce(c.status, 'intent')) IN ('won', 'confirmed') THEN c.status
        ELSE 'cancelled'
      END,
      merged_into_call_id = survivor,
      merged_reason = 'cross_session_burst_twin_merge_v1',
      note = CASE
        WHEN c.note IS NULL OR btrim(c.note) = '' THEN '[merged_into_burst_twin:' || survivor::text || ']'
        ELSE c.note || E'\n[merged_into_burst_twin:' || survivor::text || ']'
      END,
      intent_stamp = 'merged:' || c.id::text,
      version = coalesce(c.version, 0) + 1
    WHERE c.id = loser
      AND c.merged_into_call_id IS NULL;
  END IF;

  UPDATE public.outbox_events o
  SET
    status = 'PROCESSED',
    processed_at = coalesce(o.processed_at, now()),
    last_error = CASE
      WHEN o.last_error IS NULL OR btrim(o.last_error::text) = ''
      THEN 'superseded_cross_session_burst_twin_merge_v1'::text
      ELSE o.last_error || E'\n superseded_cross_session_burst_twin_merge_v1'
    END,
    updated_at = now()
  WHERE o.call_id = loser
    AND o.status IN ('PENDING', 'FAILED', 'PROCESSING');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calls_merge_cross_session_burst_twin_v1 ON public.calls;
CREATE TRIGGER trg_calls_merge_cross_session_burst_twin_v1
AFTER INSERT ON public.calls
FOR EACH ROW
EXECUTE FUNCTION public.calls_merge_cross_session_burst_twin_v1();

-- Session reuse: match active signal by burst key, not only exact intent_target string (tel vs +90 drift).
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
      AND coalesce(c.gclid, c.wbraid, c.gbraid) = p_primary_click_id
      AND lower(coalesce(c.status, 'intent')) IN ('intent', 'contacted', 'offered')
      AND c.merged_into_call_id IS NULL
      AND abs(extract(epoch FROM (v_now - c.created_at))) <= 90
      AND (
        coalesce(c.intent_target, '') = v_target
        OR (
          v_action IN ('phone', 'whatsapp')
          AND public.click_intent_burst_match_key_v1(
                coalesce(nullif(btrim(c.intent_target), ''), nullif(btrim(c.phone_number), '')),
                v_action
              ) IS NOT DISTINCT FROM public.click_intent_burst_match_key_v1(v_target, v_action)
          AND public.click_intent_burst_match_key_v1(v_target, v_action) IS NOT NULL
        )
      )
    ORDER BY abs(extract(epoch FROM (v_now - c.created_at))) ASC, c.created_at DESC
    LIMIT 1;
  END IF;

  IF v_found.sid IS NOT NULL THEN
    RETURN QUERY
    SELECT v_found.sid, v_found.smonth, true, 'reused_existing_active_signal'::text, v_found.sid, v_found.delta_ms, v_found.lifecycle;
    RETURN;
  END IF;

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
