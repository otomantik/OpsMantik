BEGIN;

CREATE OR REPLACE FUNCTION public.conversations_primary_entity_site_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_call_ok boolean := true;
  v_session_ok boolean := true;
BEGIN
  IF NEW.primary_call_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.calls ca
      WHERE ca.id = NEW.primary_call_id
        AND ca.site_id = NEW.site_id
    ) INTO v_call_ok;
  END IF;

  IF NEW.primary_session_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE s.id = NEW.primary_session_id
        AND s.site_id = NEW.site_id
    ) INTO v_session_ok;
  END IF;

  IF NOT v_call_ok OR NOT v_session_ok THEN
    RAISE EXCEPTION USING
      MESSAGE = 'conversations: primary entity must belong to the same site as conversation.site_id',
      ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.conversations_primary_entity_site_check() IS
  'Trigger: ensures conversations.primary_call_id and primary_session_id belong to the same site as conversations.site_id.';

DROP TRIGGER IF EXISTS conversations_primary_entity_site_trigger ON public.conversations;
CREATE TRIGGER conversations_primary_entity_site_trigger
  BEFORE INSERT OR UPDATE OF site_id, primary_call_id, primary_session_id
  ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.conversations_primary_entity_site_check();

CREATE OR REPLACE FUNCTION public.create_conversation_with_primary_entity(
  p_site_id uuid,
  p_primary_entity_type text,
  p_primary_entity_id uuid,
  p_primary_source jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_is_service boolean := false;
  v_call_id uuid := NULL;
  v_session_id uuid := NULL;
  v_entity_ok boolean := false;
  v_conversation public.conversations%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  v_is_service := (v_uid IS NULL AND auth.role() = 'service_role');

  IF NOT v_is_service THEN
    IF v_uid IS NULL OR NOT public.can_access_site(v_uid, p_site_id) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_primary_entity_type = 'call' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.calls ca
      WHERE ca.id = p_primary_entity_id
        AND ca.site_id = p_site_id
    ) INTO v_entity_ok;
    v_call_id := p_primary_entity_id;
  ELSIF p_primary_entity_type = 'session' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE s.id = p_primary_entity_id
        AND s.site_id = p_site_id
    ) INTO v_entity_ok;
    v_session_id := p_primary_entity_id;
  ELSE
    RAISE EXCEPTION USING MESSAGE = 'invalid_primary_entity_type', ERRCODE = 'P0001';
  END IF;

  IF NOT v_entity_ok THEN
    RAISE EXCEPTION USING MESSAGE = 'primary_entity_site_mismatch', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.conversations (
    site_id,
    status,
    primary_call_id,
    primary_session_id,
    primary_source
  )
  VALUES (
    p_site_id,
    'OPEN',
    v_call_id,
    v_session_id,
    NULLIF(p_primary_source, '{}'::jsonb)
  )
  RETURNING * INTO v_conversation;

  INSERT INTO public.conversation_links (
    conversation_id,
    entity_type,
    entity_id
  )
  VALUES (
    v_conversation.id,
    p_primary_entity_type,
    p_primary_entity_id
  );

  RETURN jsonb_build_object(
    'id', v_conversation.id,
    'site_id', v_conversation.site_id,
    'status', v_conversation.status,
    'primary_call_id', v_conversation.primary_call_id,
    'primary_session_id', v_conversation.primary_session_id,
    'primary_source', v_conversation.primary_source,
    'created_at', v_conversation.created_at,
    'updated_at', v_conversation.updated_at
  );
END;
$$;

COMMENT ON FUNCTION public.create_conversation_with_primary_entity(uuid, text, uuid, jsonb) IS
  'Atomically creates a conversation and its first conversation_links row after validating the primary entity belongs to the same site.';

GRANT EXECUTE ON FUNCTION public.create_conversation_with_primary_entity(uuid, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_conversation_with_primary_entity(uuid, text, uuid, jsonb) TO service_role;

COMMIT;
