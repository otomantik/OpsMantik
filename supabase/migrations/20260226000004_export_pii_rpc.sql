-- GDPR Export RPC: export_data_for_identifier
BEGIN;
CREATE OR REPLACE FUNCTION public.export_data_for_identifier(
  p_site_id uuid, p_identifier_type text, p_identifier_value text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session_ids uuid[] := '{}';
  v_result jsonb := '{}'::jsonb;
  v_sessions jsonb; v_events jsonb; v_calls jsonb; v_conversations jsonb; v_sales jsonb;
BEGIN
  IF p_identifier_type IS NULL OR NULLIF(TRIM(p_identifier_value), '') IS NULL THEN RETURN v_result; END IF;
  IF p_identifier_type NOT IN ('session_id', 'fingerprint', 'email') THEN RETURN v_result; END IF;
  IF p_identifier_type = 'email' THEN
    SELECT COALESCE(ARRAY_AGG(DISTINCT session_id), '{}') INTO v_session_ids FROM public.events
    WHERE site_id = p_site_id AND ((metadata->>'email')::text ILIKE p_identifier_value OR (metadata->>'email_lc')::text = lower(p_identifier_value));
  END IF;
  IF p_identifier_type = 'session_id' THEN SELECT COALESCE(jsonb_agg(to_jsonb(s.*)), '[]'::jsonb) INTO v_sessions FROM public.sessions s WHERE s.site_id = p_site_id AND s.id::text = p_identifier_value;
  ELSIF p_identifier_type = 'fingerprint' THEN SELECT COALESCE(jsonb_agg(to_jsonb(s.*)), '[]'::jsonb) INTO v_sessions FROM public.sessions s WHERE s.site_id = p_site_id AND s.fingerprint = p_identifier_value;
  ELSE SELECT COALESCE(jsonb_agg(to_jsonb(s.*)), '[]'::jsonb) INTO v_sessions FROM public.sessions s WHERE s.site_id = p_site_id AND s.id = ANY(v_session_ids); END IF;
  v_result := v_result || jsonb_build_object('sessions', COALESCE(v_sessions, '[]'::jsonb));
  IF p_identifier_type = 'session_id' THEN SELECT COALESCE(jsonb_agg(to_jsonb(e.*)), '[]'::jsonb) INTO v_events FROM public.events e WHERE e.site_id = p_site_id AND e.session_id::text = p_identifier_value;
  ELSIF p_identifier_type = 'fingerprint' THEN SELECT COALESCE(jsonb_agg(to_jsonb(e.*)), '[]'::jsonb) INTO v_events FROM public.events e WHERE e.site_id = p_site_id AND (e.metadata->>'fingerprint' = p_identifier_value OR e.metadata->>'fp' = p_identifier_value);
  ELSE SELECT COALESCE(jsonb_agg(to_jsonb(e.*)), '[]'::jsonb) INTO v_events FROM public.events e WHERE e.site_id = p_site_id AND e.session_id = ANY(v_session_ids); END IF;
  v_result := v_result || jsonb_build_object('events', COALESCE(v_events, '[]'::jsonb));
  IF p_identifier_type = 'session_id' THEN SELECT COALESCE(jsonb_agg(to_jsonb(c.*)), '[]'::jsonb) INTO v_calls FROM public.calls c WHERE c.site_id = p_site_id AND c.matched_session_id::text = p_identifier_value;
  ELSIF p_identifier_type = 'fingerprint' THEN SELECT COALESCE(jsonb_agg(to_jsonb(c.*)), '[]'::jsonb) INTO v_calls FROM public.calls c WHERE c.site_id = p_site_id AND c.matched_fingerprint = p_identifier_value;
  ELSE SELECT COALESCE(jsonb_agg(to_jsonb(c.*)), '[]'::jsonb) INTO v_calls FROM public.calls c WHERE c.site_id = p_site_id AND c.matched_session_id = ANY(v_session_ids); END IF;
  v_result := v_result || jsonb_build_object('calls', COALESCE(v_calls, '[]'::jsonb));
  SELECT COALESCE(jsonb_agg(to_jsonb(c.*)), '[]'::jsonb) INTO v_conversations FROM public.conversations c LEFT JOIN public.calls ca ON ca.id = c.primary_call_id AND ca.site_id = p_site_id WHERE c.site_id = p_site_id AND (
    (p_identifier_type = 'session_id' AND (c.primary_session_id::text = p_identifier_value OR ca.matched_session_id::text = p_identifier_value))
    OR (p_identifier_type = 'fingerprint' AND ca.matched_fingerprint = p_identifier_value)
    OR (p_identifier_type = 'email' AND c.primary_session_id = ANY(v_session_ids)));
  v_result := v_result || jsonb_build_object('conversations', COALESCE(v_conversations, '[]'::jsonb));
  SELECT COALESCE(jsonb_agg(to_jsonb(s.*)), '[]'::jsonb) INTO v_sales FROM public.sales s WHERE s.site_id = p_site_id AND s.conversation_id IN (
    SELECT c.id FROM public.conversations c LEFT JOIN public.calls ca ON ca.id = c.primary_call_id AND ca.site_id = p_site_id WHERE c.site_id = p_site_id AND (
      (p_identifier_type = 'session_id' AND (c.primary_session_id::text = p_identifier_value OR ca.matched_session_id::text = p_identifier_value))
      OR (p_identifier_type = 'fingerprint' AND ca.matched_fingerprint = p_identifier_value)
      OR (p_identifier_type = 'email' AND c.primary_session_id = ANY(v_session_ids))));
  v_result := v_result || jsonb_build_object('sales', COALESCE(v_sales, '[]'::jsonb));
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.export_data_for_identifier(uuid, text, text) TO service_role;
COMMIT;
