BEGIN;

CREATE TABLE IF NOT EXISTS public.conversation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_type text NOT NULL,
  actor_id uuid NULL,
  idempotency_key text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS assigned_to uuid NULL,
  ADD COLUMN IF NOT EXISTS phone_e164 text NULL,
  ADD COLUMN IF NOT EXISTS customer_hash text NULL,
  ADD COLUMN IF NOT EXISTS mizan_predicted_value numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_contact_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS next_follow_up_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_note_preview text NULL,
  ADD COLUMN IF NOT EXISTS won_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS lost_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS junk_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS lost_reason text NULL;

ALTER TABLE public.conversations
  ALTER COLUMN status SET DEFAULT 'OPEN',
  ALTER COLUMN stage SET DEFAULT 'new',
  ALTER COLUMN next_follow_up_at SET DEFAULT (now() + interval '1 hour');

UPDATE public.conversations
SET stage = CASE
  WHEN status = 'WON' THEN 'won'
  WHEN status = 'LOST' THEN 'lost'
  WHEN status = 'JUNK' THEN 'junk'
  ELSE 'new'
END
WHERE stage IS NULL;

UPDATE public.conversations
SET source_summary = CASE
  WHEN primary_source IS NULL THEN '{}'::jsonb
  WHEN jsonb_typeof(primary_source) = 'object' THEN primary_source
  ELSE '{}'::jsonb
END
WHERE source_summary IS NULL
   OR source_summary = '{}'::jsonb;

UPDATE public.conversations c
SET phone_e164 = COALESCE(
      NULLIF(BTRIM(c.phone_e164), ''),
      NULLIF(BTRIM(regexp_replace(COALESCE(ca.caller_phone_e164, ca.intent_target, ca.phone_number), '[^0-9+]', '', 'g')), '')
    ),
    primary_session_id = COALESCE(c.primary_session_id, ca.matched_session_id)
FROM public.calls ca
WHERE ca.id = c.primary_call_id
  AND ca.site_id = c.site_id
  AND (
    c.phone_e164 IS NULL
    OR c.primary_session_id IS NULL
  );

UPDATE public.conversations
SET last_activity_at = COALESCE(updated_at, created_at, now())
WHERE last_activity_at IS NULL
   OR last_activity_at < created_at;

UPDATE public.conversations
SET next_follow_up_at = COALESCE(next_follow_up_at, now() + interval '1 hour')
WHERE stage NOT IN ('won', 'lost', 'junk')
  AND next_follow_up_at IS NULL;

UPDATE public.conversations
SET next_follow_up_at = NULL
WHERE stage IN ('won', 'lost', 'junk');

UPDATE public.conversations
SET won_at = COALESCE(won_at, updated_at, created_at, now())
WHERE stage = 'won'
  AND won_at IS NULL;

UPDATE public.conversations
SET lost_at = COALESCE(lost_at, updated_at, created_at, now()),
    lost_reason = COALESCE(NULLIF(lost_reason, ''), 'legacy_unknown')
WHERE stage = 'lost'
  AND (lost_at IS NULL OR lost_reason IS NULL OR lost_reason = '');

UPDATE public.conversations
SET junk_at = COALESCE(junk_at, updated_at, created_at, now())
WHERE stage = 'junk'
  AND junk_at IS NULL;

ALTER TABLE public.conversations
  ALTER COLUMN stage SET NOT NULL;

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_stage_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_stage_check
  CHECK (stage IN ('new', 'contacted', 'qualified', 'proposal_sent', 'follow_up_waiting', 'won', 'lost', 'junk'));

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_ghost_identity_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_ghost_identity_check
  CHECK (
    phone_e164 IS NOT NULL
    OR customer_hash IS NOT NULL
    OR primary_session_id IS NOT NULL
    OR primary_call_id IS NOT NULL
  );

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_bureaucracy_follow_up_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_bureaucracy_follow_up_check
  CHECK (
    (
      stage NOT IN ('won', 'lost', 'junk')
      AND next_follow_up_at IS NOT NULL
    )
    OR
    (
      stage IN ('won', 'lost', 'junk')
      AND next_follow_up_at IS NULL
    )
  );

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_status_stage_integrity_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_status_stage_integrity_check
  CHECK (
    (status = 'OPEN' AND stage NOT IN ('won', 'lost', 'junk'))
    OR (status = 'WON' AND stage = 'won')
    OR (status = 'LOST' AND stage = 'lost')
    OR (status = 'JUNK' AND stage = 'junk')
  );

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_soft_funnel_integrity_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_soft_funnel_integrity_check
  CHECK (
    last_activity_at >= created_at
    AND mizan_predicted_value >= 0
  );

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_follow_up_after_create_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_follow_up_after_create_check
  CHECK (
    next_follow_up_at IS NULL
    OR next_follow_up_at >= created_at
  );

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_terminal_timestamps_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_terminal_timestamps_check
  CHECK (
    (stage <> 'won' OR won_at IS NOT NULL)
    AND (stage <> 'lost' OR (lost_at IS NOT NULL AND lost_reason IS NOT NULL AND lost_reason <> ''))
    AND (stage <> 'junk' OR junk_at IS NOT NULL)
  );

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_source_summary_object_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_source_summary_object_check
  CHECK (jsonb_typeof(source_summary) = 'object');

ALTER TABLE public.conversation_events DROP CONSTRAINT IF EXISTS conversation_events_event_type_check;
ALTER TABLE public.conversation_events ADD CONSTRAINT conversation_events_event_type_check
  CHECK (
    event_type IN (
      'conversation_created',
      'intent_linked',
      'stage_changed',
      'follow_up_set',
      'note_added',
      'assignment_changed',
      'sale_linked',
      'status_resolved',
      'reopened',
      'source_merged'
    )
  );

ALTER TABLE public.conversation_events DROP CONSTRAINT IF EXISTS conversation_events_actor_type_check;
ALTER TABLE public.conversation_events ADD CONSTRAINT conversation_events_actor_type_check
  CHECK (actor_type IN ('user', 'system', 'probe', 'worker', 'api'));

ALTER TABLE public.conversation_events DROP CONSTRAINT IF EXISTS conversation_events_payload_object_check;
ALTER TABLE public.conversation_events ADD CONSTRAINT conversation_events_payload_object_check
  CHECK (jsonb_typeof(payload) = 'object');

CREATE INDEX IF NOT EXISTS idx_conversations_active_inbox
  ON public.conversations(site_id, status, stage, next_follow_up_at)
  WHERE stage NOT IN ('won', 'lost', 'junk');

CREATE INDEX IF NOT EXISTS idx_conversations_identity_phone
  ON public.conversations(site_id, phone_e164)
  WHERE phone_e164 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_identity_customer_hash
  ON public.conversations(site_id, customer_hash)
  WHERE customer_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_events_conversation_created_at_desc
  ON public.conversation_events(conversation_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_events_timeline_idempotency
  ON public.conversation_events(conversation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.conversation_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION USING
    MESSAGE = 'conversation_events is append-only',
    ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS conversation_events_block_update ON public.conversation_events;
CREATE TRIGGER conversation_events_block_update
  BEFORE UPDATE ON public.conversation_events
  FOR EACH ROW
  EXECUTE FUNCTION public.conversation_events_block_mutation();

DROP TRIGGER IF EXISTS conversation_events_block_delete ON public.conversation_events;
CREATE TRIGGER conversation_events_block_delete
  BEFORE DELETE ON public.conversation_events
  FOR EACH ROW
  EXECUTE FUNCTION public.conversation_events_block_mutation();

CREATE OR REPLACE FUNCTION public.conversation_events_site_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_id uuid;
BEGIN
  SELECT c.site_id
  INTO v_site_id
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id;

  IF v_site_id IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'conversation_events: conversation not found',
      ERRCODE = 'P0001';
  END IF;

  IF NEW.site_id IS DISTINCT FROM v_site_id THEN
    RAISE EXCEPTION USING
      MESSAGE = 'conversation_events: site_id must match parent conversation',
      ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversation_events_site_trigger ON public.conversation_events;
CREATE TRIGGER conversation_events_site_trigger
  BEFORE INSERT ON public.conversation_events
  FOR EACH ROW
  EXECUTE FUNCTION public.conversation_events_site_check();

DROP TRIGGER IF EXISTS conversations_set_updated_at ON public.conversations;
CREATE TRIGGER conversations_set_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.conversation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversation_events_select_via_site" ON public.conversation_events;
CREATE POLICY "conversation_events_select_via_site"
  ON public.conversation_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sites s
      WHERE s.id = public.conversation_events.site_id
        AND (
          s.user_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.site_members sm
            WHERE sm.site_id = s.id
              AND sm.user_id = auth.uid()
          )
          OR public.is_admin(auth.uid())
        )
    )
  );

GRANT SELECT ON public.conversation_events TO authenticated;
GRANT ALL ON public.conversation_events TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_intent_and_upsert_conversation(
  p_site_id uuid,
  p_phone_e164 text DEFAULT NULL,
  p_customer_hash text DEFAULT NULL,
  p_primary_call_id uuid DEFAULT NULL,
  p_primary_session_id uuid DEFAULT NULL,
  p_mizan_value numeric DEFAULT 0,
  p_source_summary jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service boolean := (auth.uid() IS NULL AND auth.role() = 'service_role');
  v_phone_e164 text := NULLIF(btrim(p_phone_e164), '');
  v_customer_hash text := NULLIF(btrim(p_customer_hash), '');
  v_identity_key text;
  v_now timestamptz := now();
  v_source_summary jsonb := CASE
    WHEN p_source_summary IS NULL THEN '{}'::jsonb
    WHEN jsonb_typeof(p_source_summary) = 'object' THEN p_source_summary
    ELSE '{}'::jsonb
  END;
  v_mizan_value numeric(10,2) := GREATEST(COALESCE(p_mizan_value, 0), 0)::numeric(10,2);
  v_conversation_id uuid;
  v_event_type text;
BEGIN
  IF p_site_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'resolve_intent_and_upsert_conversation: p_site_id is required', ERRCODE = 'P0001';
  END IF;

  IF NOT v_is_service THEN
    IF v_uid IS NULL OR NOT public.can_access_site(v_uid, p_site_id) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_phone_e164 IS NULL AND v_customer_hash IS NULL AND p_primary_session_id IS NULL AND p_primary_call_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'resolve_intent_and_upsert_conversation: identity is required', ERRCODE = 'P0001';
  END IF;

  IF p_primary_call_id IS NOT NULL AND v_phone_e164 IS NULL THEN
    SELECT NULLIF(BTRIM(regexp_replace(COALESCE(ca.caller_phone_e164, ca.intent_target, ca.phone_number), '[^0-9+]', '', 'g')), '')
    INTO v_phone_e164
    FROM public.calls ca
    WHERE ca.id = p_primary_call_id
      AND ca.site_id = p_site_id
    LIMIT 1;
  END IF;

  v_identity_key := COALESCE(v_phone_e164, v_customer_hash, p_primary_session_id::text, p_primary_call_id::text, 'fallback');

  PERFORM pg_advisory_xact_lock(
    hashtext(p_site_id::text),
    hashtext(v_identity_key)
  );

  IF v_phone_e164 IS NOT NULL THEN
    SELECT c.id
    INTO v_conversation_id
    FROM public.conversations c
    WHERE c.site_id = p_site_id
      AND c.status = 'OPEN'
      AND c.phone_e164 = v_phone_e164
    ORDER BY c.last_activity_at DESC, c.created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_conversation_id IS NULL AND v_customer_hash IS NOT NULL THEN
    SELECT c.id
    INTO v_conversation_id
    FROM public.conversations c
    WHERE c.site_id = p_site_id
      AND c.status = 'OPEN'
      AND c.customer_hash = v_customer_hash
    ORDER BY c.last_activity_at DESC, c.created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_conversation_id IS NULL AND p_primary_session_id IS NOT NULL THEN
    SELECT c.id
    INTO v_conversation_id
    FROM public.conversations c
    WHERE c.site_id = p_site_id
      AND c.status = 'OPEN'
      AND c.primary_session_id = p_primary_session_id
    ORDER BY c.last_activity_at DESC, c.created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_conversation_id IS NULL AND p_primary_call_id IS NOT NULL THEN
    SELECT c.id
    INTO v_conversation_id
    FROM public.conversations c
    WHERE c.site_id = p_site_id
      AND c.status = 'OPEN'
      AND c.primary_call_id = p_primary_call_id
    ORDER BY c.last_activity_at DESC, c.created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_conversation_id IS NULL THEN
    INSERT INTO public.conversations (
      site_id,
      stage,
      status,
      phone_e164,
      customer_hash,
      primary_call_id,
      primary_session_id,
      mizan_predicted_value,
      source_summary,
      last_activity_at,
      next_follow_up_at
    )
    VALUES (
      p_site_id,
      'new',
      'OPEN',
      v_phone_e164,
      v_customer_hash,
      p_primary_call_id,
      p_primary_session_id,
      v_mizan_value,
      v_source_summary,
      v_now,
      v_now + interval '1 hour'
    )
    RETURNING id INTO v_conversation_id;

    v_event_type := 'conversation_created';
  ELSE
    IF p_idempotency_key IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.conversation_events e
      WHERE e.conversation_id = v_conversation_id
        AND e.idempotency_key = p_idempotency_key
    ) THEN
      RETURN v_conversation_id;
    END IF;

    UPDATE public.conversations c
    SET phone_e164 = COALESCE(c.phone_e164, v_phone_e164),
        customer_hash = COALESCE(c.customer_hash, v_customer_hash),
        primary_call_id = COALESCE(c.primary_call_id, p_primary_call_id),
        primary_session_id = COALESCE(c.primary_session_id, p_primary_session_id),
        mizan_predicted_value = COALESCE(c.mizan_predicted_value, 0) + v_mizan_value,
        source_summary = CASE
          WHEN v_source_summary = '{}'::jsonb THEN c.source_summary
          ELSE COALESCE(c.source_summary, '{}'::jsonb) || v_source_summary
        END,
        last_activity_at = v_now,
        updated_at = v_now
    WHERE c.id = v_conversation_id;

    v_event_type := 'intent_linked';
  END IF;

  IF p_idempotency_key IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.conversation_events e
    WHERE e.conversation_id = v_conversation_id
      AND e.idempotency_key = p_idempotency_key
  ) THEN
    INSERT INTO public.conversation_events (
      conversation_id,
      site_id,
      event_type,
      actor_type,
      actor_id,
      idempotency_key,
      payload
    )
    VALUES (
      v_conversation_id,
      p_site_id,
      v_event_type,
      'system',
      NULL,
      p_idempotency_key,
      jsonb_build_object(
        'phone_e164', v_phone_e164,
        'customer_hash', v_customer_hash,
        'primary_call_id', p_primary_call_id,
        'primary_session_id', p_primary_session_id,
        'mizan_predicted_value', v_mizan_value,
        'source_summary', v_source_summary
      )
    );
  END IF;

  RETURN v_conversation_id;
END;
$$;

COMMENT ON FUNCTION public.resolve_intent_and_upsert_conversation(uuid, text, text, uuid, uuid, numeric, jsonb, text) IS
  'Service-kernel RPC: upserts an OPEN conversation from intent/call identity, applies advisory locking, and appends an immutable timeline event.';

REVOKE ALL ON FUNCTION public.resolve_intent_and_upsert_conversation(uuid, text, text, uuid, uuid, numeric, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_intent_and_upsert_conversation(uuid, text, text, uuid, uuid, numeric, jsonb, text) TO service_role;

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
  v_uid uuid := auth.uid();
  v_is_service boolean := (auth.uid() IS NULL AND auth.role() = 'service_role');
  v_call_id uuid := NULL;
  v_session_id uuid := NULL;
  v_phone_e164 text := NULL;
  v_entity_ok boolean := false;
  v_conversation public.conversations%ROWTYPE;
BEGIN
  IF NOT v_is_service THEN
    IF v_uid IS NULL OR NOT public.can_access_site(v_uid, p_site_id) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_primary_entity_type = 'call' THEN
    SELECT
      true,
      ca.id,
      COALESCE(ca.matched_session_id, v_session_id),
      NULLIF(BTRIM(regexp_replace(COALESCE(ca.caller_phone_e164, ca.intent_target, ca.phone_number), '[^0-9+]', '', 'g')), '')
    INTO v_entity_ok, v_call_id, v_session_id, v_phone_e164
    FROM public.calls ca
    WHERE ca.id = p_primary_entity_id
      AND ca.site_id = p_site_id
    LIMIT 1;
  ELSIF p_primary_entity_type = 'session' THEN
    SELECT true, s.id
    INTO v_entity_ok, v_session_id
    FROM public.sessions s
    WHERE s.id = p_primary_entity_id
      AND s.site_id = p_site_id
    LIMIT 1;
  ELSE
    RAISE EXCEPTION USING MESSAGE = 'invalid_primary_entity_type', ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(v_entity_ok, false) THEN
    RAISE EXCEPTION USING MESSAGE = 'primary_entity_site_mismatch', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.conversations (
    site_id,
    status,
    stage,
    primary_call_id,
    primary_session_id,
    phone_e164,
    primary_source
  )
  VALUES (
    p_site_id,
    'OPEN',
    'new',
    v_call_id,
    v_session_id,
    v_phone_e164,
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

  INSERT INTO public.conversation_events (
    conversation_id,
    site_id,
    event_type,
    actor_type,
    actor_id,
    payload
  )
  VALUES (
    v_conversation.id,
    v_conversation.site_id,
    'conversation_created',
    CASE WHEN v_is_service THEN 'system' ELSE 'user' END,
    CASE WHEN v_is_service THEN NULL ELSE v_uid END,
    jsonb_build_object(
      'primary_entity_type', p_primary_entity_type,
      'primary_entity_id', p_primary_entity_id,
      'phone_e164', v_phone_e164
    )
  );

  RETURN jsonb_build_object(
    'id', v_conversation.id,
    'site_id', v_conversation.site_id,
    'status', v_conversation.status,
    'stage', v_conversation.stage,
    'primary_call_id', v_conversation.primary_call_id,
    'primary_session_id', v_conversation.primary_session_id,
    'phone_e164', v_conversation.phone_e164,
    'primary_source', v_conversation.primary_source,
    'created_at', v_conversation.created_at,
    'updated_at', v_conversation.updated_at
  );
END;
$$;

COMMENT ON FUNCTION public.create_conversation_with_primary_entity(uuid, text, uuid, jsonb) IS
  'Creates a conversation from a primary call/session, derives identity for Phase 1 ghost rules, and appends the first timeline event.';

CREATE OR REPLACE FUNCTION public.resolve_conversation_with_sale_link(
  p_conversation_id uuid,
  p_status text,
  p_note text DEFAULT NULL,
  p_sale_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation public.conversations%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_uid uuid := auth.uid();
  v_is_service boolean := (auth.uid() IS NULL AND auth.role() = 'service_role');
  v_stage text;
  v_now timestamptz := now();
BEGIN
  IF p_status NOT IN ('WON', 'LOST', 'JUNK') THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_status', ERRCODE = 'P0001';
  END IF;

  v_stage := CASE
    WHEN p_status = 'WON' THEN 'won'
    WHEN p_status = 'LOST' THEN 'lost'
    ELSE 'junk'
  END;

  SELECT * INTO v_conversation
  FROM public.conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'conversation_not_found', ERRCODE = 'P0001';
  END IF;

  IF NOT v_is_service THEN
    IF v_uid IS NULL OR NOT public.can_access_site(v_uid, v_conversation.site_id) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_sale_id IS NOT NULL THEN
    SELECT * INTO v_sale
    FROM public.sales
    WHERE id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'sale_not_found', ERRCODE = 'P0001';
    END IF;

    IF v_sale.site_id IS DISTINCT FROM v_conversation.site_id THEN
      RAISE EXCEPTION USING MESSAGE = 'sale_site_mismatch', ERRCODE = 'P0001';
    END IF;

    IF v_sale.conversation_id IS NOT NULL AND v_sale.conversation_id IS DISTINCT FROM v_conversation.id THEN
      RAISE EXCEPTION USING MESSAGE = 'sale_already_linked_elsewhere', ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.conversations
  SET
    status = p_status,
    stage = v_stage,
    note = CASE WHEN p_note IS NULL THEN note ELSE p_note END,
    last_note_preview = CASE WHEN p_note IS NULL THEN last_note_preview ELSE LEFT(p_note, 240) END,
    next_follow_up_at = NULL,
    won_at = CASE WHEN v_stage = 'won' THEN COALESCE(won_at, v_now) ELSE won_at END,
    lost_at = CASE WHEN v_stage = 'lost' THEN COALESCE(lost_at, v_now) ELSE lost_at END,
    lost_reason = CASE
      WHEN v_stage = 'lost' THEN COALESCE(NULLIF(lost_reason, ''), 'manual_resolution')
      ELSE lost_reason
    END,
    junk_at = CASE WHEN v_stage = 'junk' THEN COALESCE(junk_at, v_now) ELSE junk_at END,
    last_activity_at = v_now,
    updated_at = v_now
  WHERE id = v_conversation.id
  RETURNING * INTO v_conversation;

  IF p_sale_id IS NOT NULL THEN
    UPDATE public.sales
    SET
      conversation_id = v_conversation.id,
      updated_at = v_now
    WHERE id = p_sale_id
    RETURNING * INTO v_sale;

    IF v_sale.status = 'CONFIRMED' THEN
      PERFORM public.update_offline_conversion_queue_attribution(p_sale_id);
    END IF;
  END IF;

  INSERT INTO public.conversation_events (
    conversation_id,
    site_id,
    event_type,
    actor_type,
    actor_id,
    payload
  )
  VALUES (
    v_conversation.id,
    v_conversation.site_id,
    'status_resolved',
    CASE WHEN v_is_service THEN 'system' ELSE 'user' END,
    CASE WHEN v_is_service THEN NULL ELSE v_uid END,
    jsonb_build_object(
      'status', p_status,
      'stage', v_stage,
      'sale_id', p_sale_id,
      'note_present', p_note IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'id', v_conversation.id,
    'site_id', v_conversation.site_id,
    'status', v_conversation.status,
    'stage', v_conversation.stage,
    'note', v_conversation.note,
    'primary_call_id', v_conversation.primary_call_id,
    'primary_session_id', v_conversation.primary_session_id,
    'primary_source', v_conversation.primary_source,
    'created_at', v_conversation.created_at,
    'updated_at', v_conversation.updated_at
  );
END;
$$;

COMMIT;
