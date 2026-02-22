-- =============================================================================
-- GDPR Erase RPC: erase_pii_for_identifier
-- Anonymizes PII across sessions, events, calls, conversations, sales,
-- offline_conversion_queue, sync_dlq, ingest_fallback_buffer.
-- v1: sync_dlq/ingest_fallback_buffer payload = full replace (no recursive walk).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.erase_pii_for_identifier(
  p_site_id uuid,
  p_identifier_type text,
  p_identifier_value text
)
RETURNS TABLE (
  sessions_affected bigint,
  events_affected bigint,
  calls_affected bigint,
  conversations_affected bigint,
  sales_affected bigint,
  ociq_affected bigint,
  sync_dlq_affected bigint,
  ingest_fallback_affected bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_ids uuid[] := '{}';
  v_call_ids uuid[] := '{}';
  v_sale_ociq bigint := 0;
  v_sessions bigint := 0;
  v_events bigint := 0;
  v_calls bigint := 0;
  v_conversations bigint := 0;
  v_sales bigint := 0;
  v_ociq bigint := 0;
  v_dlq bigint := 0;
  v_fallback bigint := 0;
  v_redacted jsonb;
  v_conversation_ids uuid[];
  v_sale_ids uuid[];
BEGIN
  IF p_identifier_type IS NULL OR NULLIF(TRIM(p_identifier_value), '') IS NULL THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  v_redacted := jsonb_build_object(
    'redacted', true,
    'redacted_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reason', 'gdpr_erase'
  );

  IF p_identifier_type NOT IN ('session_id', 'fingerprint', 'email') THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  -- Resolve v_session_ids for email BEFORE any updates (events.metadata gets cleared later)
  IF p_identifier_type = 'email' THEN
    SELECT ARRAY_AGG(DISTINCT session_id) INTO v_session_ids
    FROM public.events
    WHERE site_id = p_site_id
      AND ((metadata->>'email')::text ILIKE p_identifier_value OR (metadata->>'email_lc')::text = lower(p_identifier_value));
    v_session_ids := COALESCE(v_session_ids, '{}');
  END IF;

  -- Resolve conversation_ids and sale_ids BEFORE any updates (data needed for fingerprint/call lookups)
  SELECT ARRAY_AGG(DISTINCT c.id) INTO v_conversation_ids
  FROM public.conversations c
  LEFT JOIN public.calls ca ON ca.id = c.primary_call_id AND ca.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND (
      (p_identifier_type = 'session_id' AND (c.primary_session_id::text = p_identifier_value))
      OR (p_identifier_type = 'session_id' AND ca.matched_session_id::text = p_identifier_value)
      OR (p_identifier_type = 'fingerprint' AND ca.matched_fingerprint = p_identifier_value)
      OR (p_identifier_type = 'email' AND EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.session_id = c.primary_session_id AND e.site_id = p_site_id
          AND ((e.metadata->>'email')::text ILIKE p_identifier_value OR (e.metadata->>'email_lc')::text = lower(p_identifier_value))
      ))
    );

  IF v_conversation_ids IS NOT NULL AND array_length(v_conversation_ids, 1) > 0 THEN
    SELECT ARRAY_AGG(DISTINCT s.id) INTO v_sale_ids FROM public.sales s WHERE s.conversation_id = ANY(v_conversation_ids);
  END IF;

  -- 1) Sessions: NULL PII columns (preserve billing: value_cents, event_count, total_duration_sec)
  WITH upds AS (
    UPDATE public.sessions
    SET
      ip_address = NULL,
      entry_page = NULL,
      exit_page = NULL,
      gclid = NULL,
      wbraid = NULL,
      gbraid = NULL,
      fingerprint = NULL,
      city = NULL,
      district = NULL,
      ai_summary = NULL,
      ai_tags = NULL,
      user_journey_path = NULL
    WHERE site_id = p_site_id
      AND (
        (p_identifier_type = 'session_id' AND id::text = p_identifier_value)
        OR (p_identifier_type = 'fingerprint' AND fingerprint = p_identifier_value)
        OR (p_identifier_type = 'email' AND id = ANY(v_session_ids))
      )
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_sessions FROM upds;

  -- 2) Events: NULL metadata (v1: full clear for safety)
  WITH upds AS (
    UPDATE public.events
    SET metadata = '{}'
    WHERE site_id = p_site_id
      AND (
        (p_identifier_type = 'session_id' AND session_id::text = p_identifier_value)
        OR (p_identifier_type = 'fingerprint' AND (metadata->>'fingerprint' = p_identifier_value OR metadata->>'fp' = p_identifier_value))
        OR (p_identifier_type = 'email' AND session_id = ANY(v_session_ids))
      )
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_events FROM upds;

  -- 3) Calls: collect IDs for ociq, then redact PII
  SELECT ARRAY_AGG(id) INTO v_call_ids FROM public.calls
  WHERE site_id = p_site_id
    AND (
      (p_identifier_type = 'session_id' AND matched_session_id::text = p_identifier_value)
      OR (p_identifier_type = 'fingerprint' AND matched_fingerprint = p_identifier_value)
      OR (p_identifier_type = 'email' AND matched_session_id = ANY(v_session_ids))
    );
  v_call_ids := COALESCE(v_call_ids, '{}');

  WITH upds AS (
    UPDATE public.calls
    SET
      phone_number = '[REDACTED]',
      matched_fingerprint = NULL,
      click_id = NULL,
      intent_page_url = NULL
    WHERE id = ANY(v_call_ids)
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_calls FROM upds;

  -- 3b) offline_conversion_queue by call_id (redact gclid/wbraid/gbraid)
  IF array_length(v_call_ids, 1) > 0 THEN
    WITH upds AS (
      UPDATE public.offline_conversion_queue SET gclid = NULL, wbraid = NULL, gbraid = NULL WHERE call_id = ANY(v_call_ids) RETURNING 1
    )
    SELECT count(*)::bigint INTO v_ociq FROM upds;
  END IF;

  -- 5) Conversations: NULL note, primary_source (v_conversation_ids resolved at start)
  IF v_conversation_ids IS NOT NULL AND array_length(v_conversation_ids, 1) > 0 THEN
    WITH upds AS (
      UPDATE public.conversations SET note = NULL, primary_source = NULL WHERE id = ANY(v_conversation_ids) RETURNING 1
    )
    SELECT count(*)::bigint INTO v_conversations FROM upds;
  END IF;

  -- 6) Sales: NULL customer_hash, notes (v_sale_ids from conversations)
  IF v_sale_ids IS NOT NULL AND array_length(v_sale_ids, 1) > 0 THEN
    WITH upds AS (
      UPDATE public.sales SET customer_hash = NULL, notes = NULL WHERE id = ANY(v_sale_ids) RETURNING 1
    )
    SELECT count(*)::bigint INTO v_sales FROM upds;
  END IF;

  -- 7) offline_conversion_queue by sale_id: NULL gclid, wbraid, gbraid
  IF v_sale_ids IS NOT NULL AND array_length(v_sale_ids, 1) > 0 THEN
    WITH upds AS (
      UPDATE public.offline_conversion_queue SET gclid = NULL, wbraid = NULL, gbraid = NULL WHERE sale_id = ANY(v_sale_ids) RETURNING 1
    )
    SELECT count(*)::bigint INTO v_sale_ociq FROM upds;
  END IF;
  v_ociq := v_ociq + v_sale_ociq;

  -- 8) sync_dlq: full payload replace where payload contains identifier
  WITH upds AS (
    UPDATE public.sync_dlq
    SET payload = v_redacted
    WHERE (site_id = p_site_id OR site_id IS NULL)
      AND (
        (payload->>'sid' = p_identifier_value)
        OR (payload->'meta'->>'fp' = p_identifier_value)
        OR (payload->'meta'->>'fingerprint' = p_identifier_value)
        OR (payload->'meta'->>'email')::text ILIKE p_identifier_value
        OR (payload->>'email')::text ILIKE p_identifier_value
      )
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_dlq FROM upds;

  -- 9) ingest_fallback_buffer: full payload replace
  WITH upds AS (
    UPDATE public.ingest_fallback_buffer
    SET payload = v_redacted
    WHERE site_id = p_site_id
      AND (
        (payload->>'sid' = p_identifier_value)
        OR (payload->'meta'->>'fp' = p_identifier_value)
        OR (payload->'meta'->>'fingerprint' = p_identifier_value)
        OR (payload->'meta'->>'email')::text ILIKE p_identifier_value
        OR (payload->>'email')::text ILIKE p_identifier_value
      )
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_fallback FROM upds;

  RETURN QUERY SELECT v_sessions, v_events, v_calls, v_conversations, v_sales, v_ociq, v_dlq, v_fallback;
END;
$$;

COMMENT ON FUNCTION public.erase_pii_for_identifier(uuid, text, text) IS
  'KVKK/GDPR: PII anonymization by identifier. session_id|fingerprint|email. sync_dlq/ingest_fallback: payload full replace.';

GRANT EXECUTE ON FUNCTION public.erase_pii_for_identifier(uuid, text, text) TO service_role;

COMMIT;
