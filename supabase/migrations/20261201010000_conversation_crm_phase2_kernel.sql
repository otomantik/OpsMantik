BEGIN;

CREATE OR REPLACE FUNCTION public.get_conversation_inbox_v1(
  p_site_id uuid,
  p_bucket text DEFAULT 'active',
  p_stage text DEFAULT NULL,
  p_assigned_to uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service boolean := (v_uid IS NULL AND public._jwt_role() = 'service_role');
  v_bucket text := lower(COALESCE(NULLIF(btrim(p_bucket), ''), 'active'));
  v_stage text := NULLIF(btrim(p_stage), '');
  v_search text := NULLIF(btrim(p_search), '');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF p_site_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'site_id_required', ERRCODE = 'P0001';
  END IF;

  IF v_bucket NOT IN ('active', 'all', 'overdue', 'today', 'unassigned') THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_bucket', ERRCODE = 'P0001';
  END IF;

  IF v_stage IS NOT NULL AND v_stage NOT IN ('new', 'contacted', 'qualified', 'proposal_sent', 'follow_up_waiting', 'won', 'lost', 'junk') THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_stage', ERRCODE = 'P0001';
  END IF;

  IF NOT v_is_service THEN
    IF v_uid IS NULL OR NOT public.can_access_site(v_uid, p_site_id) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN (
    WITH full_scope AS (
      SELECT c.*
      FROM public.conversations c
      WHERE c.site_id = p_site_id
        AND (
          v_stage IS NULL
          OR c.stage = v_stage
        )
        AND (
          p_assigned_to IS NULL
          OR c.assigned_to IS NOT DISTINCT FROM p_assigned_to
        )
        AND (
          v_search IS NULL
          OR c.id::text ILIKE '%' || v_search || '%'
          OR COALESCE(c.phone_e164, '') ILIKE '%' || v_search || '%'
          OR COALESCE(c.customer_hash, '') ILIKE '%' || v_search || '%'
          OR COALESCE(c.last_note_preview, '') ILIKE '%' || v_search || '%'
        )
    ),
    filtered AS (
      SELECT *
      FROM full_scope c
      WHERE CASE
        WHEN v_bucket = 'all' THEN true
        WHEN v_bucket = 'active' THEN c.stage NOT IN ('won', 'lost', 'junk')
        WHEN v_bucket = 'overdue' THEN c.stage NOT IN ('won', 'lost', 'junk') AND c.next_follow_up_at < now()
        WHEN v_bucket = 'today' THEN c.stage NOT IN ('won', 'lost', 'junk') AND c.next_follow_up_at >= date_trunc('day', now()) AND c.next_follow_up_at < date_trunc('day', now()) + interval '1 day'
        WHEN v_bucket = 'unassigned' THEN c.stage NOT IN ('won', 'lost', 'junk') AND c.assigned_to IS NULL
        ELSE false
      END
    ),
    ordered AS (
      SELECT *
      FROM filtered c
      ORDER BY
        c.next_follow_up_at NULLS LAST,
        c.last_activity_at DESC,
        c.created_at DESC
      LIMIT v_limit
      OFFSET v_offset
    ),
    items AS (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'site_id', o.site_id,
            'status', o.status,
            'stage', o.stage,
            'assigned_to', o.assigned_to,
            'phone_e164', o.phone_e164,
            'customer_hash', o.customer_hash,
            'mizan_predicted_value', o.mizan_predicted_value,
            'source_summary', o.source_summary,
            'last_activity_at', o.last_activity_at,
            'last_contact_at', o.last_contact_at,
            'next_follow_up_at', o.next_follow_up_at,
            'last_note_preview', o.last_note_preview,
            'won_at', o.won_at,
            'lost_at', o.lost_at,
            'junk_at', o.junk_at,
            'lost_reason', o.lost_reason,
            'primary_call_id', o.primary_call_id,
            'primary_session_id', o.primary_session_id,
            'created_at', o.created_at,
            'updated_at', o.updated_at
          )
          ORDER BY o.next_follow_up_at NULLS LAST, o.last_activity_at DESC, o.created_at DESC
        ),
        '[]'::jsonb
      ) AS value
      FROM ordered o
    ),
    summary AS (
      SELECT jsonb_build_object(
        'filtered_total', (SELECT COUNT(*) FROM filtered),
        'total_active', COUNT(*) FILTER (WHERE c.stage NOT IN ('won', 'lost', 'junk')),
        'overdue', COUNT(*) FILTER (WHERE c.stage NOT IN ('won', 'lost', 'junk') AND c.next_follow_up_at < now()),
        'today', COUNT(*) FILTER (
          WHERE c.stage NOT IN ('won', 'lost', 'junk')
            AND c.next_follow_up_at >= date_trunc('day', now())
            AND c.next_follow_up_at < date_trunc('day', now()) + interval '1 day'
        ),
        'unassigned', COUNT(*) FILTER (WHERE c.stage NOT IN ('won', 'lost', 'junk') AND c.assigned_to IS NULL)
      ) AS value
      FROM full_scope c
    )
    SELECT jsonb_build_object(
      'items', items.value,
      'summary', summary.value,
      'paging', jsonb_build_object(
        'limit', v_limit,
        'offset', v_offset,
        'bucket', v_bucket,
        'stage', v_stage,
        'assigned_to', p_assigned_to,
        'search', v_search
      )
    )
    FROM items, summary
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_conversation_detail_v1(
  p_conversation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service boolean := (v_uid IS NULL AND public._jwt_role() = 'service_role');
  v_conversation public.conversations%ROWTYPE;
BEGIN
  SELECT *
  INTO v_conversation
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'conversation_not_found', ERRCODE = 'P0001';
  END IF;

  IF NOT v_is_service THEN
    IF v_uid IS NULL OR NOT public.can_access_site(v_uid, v_conversation.site_id) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'conversation', to_jsonb(v_conversation),
    'timeline', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'event_type', e.event_type,
          'actor_type', e.actor_type,
          'actor_id', e.actor_id,
          'idempotency_key', e.idempotency_key,
          'payload', e.payload,
          'created_at', e.created_at
        )
        ORDER BY e.created_at DESC, e.id DESC
      )
      FROM public.conversation_events e
      WHERE e.conversation_id = v_conversation.id
    ), '[]'::jsonb),
    'links', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', cl.id,
          'entity_type', cl.entity_type,
          'entity_id', cl.entity_id,
          'created_at', cl.created_at
        )
        ORDER BY cl.created_at DESC, cl.id DESC
      )
      FROM public.conversation_links cl
      WHERE cl.conversation_id = v_conversation.id
    ), '[]'::jsonb),
    'sales', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'occurred_at', s.occurred_at,
          'amount_cents', s.amount_cents,
          'currency', s.currency,
          'status', s.status,
          'external_ref', s.external_ref,
          'customer_hash', s.customer_hash,
          'notes', s.notes,
          'created_at', s.created_at,
          'updated_at', s.updated_at
        )
        ORDER BY s.occurred_at DESC, s.created_at DESC
      )
      FROM public.sales s
      WHERE s.conversation_id = v_conversation.id
        AND s.site_id = v_conversation.site_id
    ), '[]'::jsonb),
    'primary_call', (
      SELECT to_jsonb(x)
      FROM (
        SELECT
          ca.id,
          ca.phone_number,
          ca.caller_phone_e164,
          ca.intent_action,
          ca.intent_target,
          ca.status,
          ca.source,
          ca.lead_score,
          ca.created_at,
          ca.matched_session_id
        FROM public.calls ca
        WHERE ca.id = v_conversation.primary_call_id
          AND ca.site_id = v_conversation.site_id
        LIMIT 1
      ) x
    ),
    'primary_session', (
      SELECT to_jsonb(x)
      FROM (
        SELECT
          s.id,
          s.created_at,
          s.gclid,
          s.wbraid,
          s.gbraid,
          s.utm_source,
          s.utm_medium,
          s.utm_campaign,
          s.utm_content,
          s.utm_term,
          s.referrer_host
        FROM public.sessions s
        WHERE s.id = v_conversation.primary_session_id
          AND s.site_id = v_conversation.site_id
        LIMIT 1
      ) x
    ),
    'stats', jsonb_build_object(
      'timeline_count', (SELECT COUNT(*) FROM public.conversation_events e WHERE e.conversation_id = v_conversation.id),
      'sales_count', (SELECT COUNT(*) FROM public.sales s WHERE s.conversation_id = v_conversation.id AND s.site_id = v_conversation.site_id),
      'link_count', (SELECT COUNT(*) FROM public.conversation_links cl WHERE cl.conversation_id = v_conversation.id)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.conversation_assign_v1(
  p_conversation_id uuid,
  p_assigned_to uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service boolean := (v_uid IS NULL AND public._jwt_role() = 'service_role');
  v_conversation public.conversations%ROWTYPE;
  v_now timestamptz := now();
  v_assignee_ok boolean := false;
BEGIN
  SELECT *
  INTO v_conversation
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

  IF p_assigned_to IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.sites s
      WHERE s.id = v_conversation.site_id
        AND (
          s.user_id = p_assigned_to
          OR EXISTS (
            SELECT 1
            FROM public.site_members sm
            WHERE sm.site_id = s.id
              AND sm.user_id = p_assigned_to
          )
          OR public.is_admin(p_assigned_to)
        )
    )
    INTO v_assignee_ok;

    IF NOT v_assignee_ok THEN
      RAISE EXCEPTION USING MESSAGE = 'assignee_site_mismatch', ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.conversations
  SET assigned_to = p_assigned_to,
      last_activity_at = v_now,
      updated_at = v_now
  WHERE id = v_conversation.id
  RETURNING * INTO v_conversation;

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
    'assignment_changed',
    CASE WHEN v_is_service THEN 'system' ELSE 'user' END,
    CASE WHEN v_is_service THEN NULL ELSE v_uid END,
    jsonb_build_object('assigned_to', p_assigned_to)
  );

  RETURN jsonb_build_object(
    'id', v_conversation.id,
    'assigned_to', v_conversation.assigned_to,
    'stage', v_conversation.stage,
    'status', v_conversation.status,
    'updated_at', v_conversation.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.conversation_add_note_v1(
  p_conversation_id uuid,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service boolean := (v_uid IS NULL AND public._jwt_role() = 'service_role');
  v_conversation public.conversations%ROWTYPE;
  v_now timestamptz := now();
  v_note text := NULLIF(btrim(p_note), '');
BEGIN
  IF v_note IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'note_required', ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_conversation
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

  UPDATE public.conversations
  SET note = v_note,
      last_note_preview = LEFT(v_note, 240),
      last_activity_at = v_now,
      updated_at = v_now
  WHERE id = v_conversation.id
  RETURNING * INTO v_conversation;

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
    'note_added',
    CASE WHEN v_is_service THEN 'system' ELSE 'user' END,
    CASE WHEN v_is_service THEN NULL ELSE v_uid END,
    jsonb_build_object('note', v_note)
  );

  RETURN jsonb_build_object(
    'id', v_conversation.id,
    'note', v_conversation.note,
    'last_note_preview', v_conversation.last_note_preview,
    'updated_at', v_conversation.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.conversation_set_follow_up_v1(
  p_conversation_id uuid,
  p_next_follow_up_at timestamptz,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service boolean := (v_uid IS NULL AND public._jwt_role() = 'service_role');
  v_conversation public.conversations%ROWTYPE;
  v_now timestamptz := now();
  v_note text := NULLIF(btrim(p_note), '');
BEGIN
  IF p_next_follow_up_at IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'follow_up_required', ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_conversation
  FROM public.conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'conversation_not_found', ERRCODE = 'P0001';
  END IF;

  IF v_conversation.stage IN ('won', 'lost', 'junk') THEN
    RAISE EXCEPTION USING MESSAGE = 'conversation_not_actionable', ERRCODE = 'P0001';
  END IF;

  IF p_next_follow_up_at < v_conversation.created_at THEN
    RAISE EXCEPTION USING MESSAGE = 'follow_up_before_create', ERRCODE = 'P0001';
  END IF;

  IF NOT v_is_service THEN
    IF v_uid IS NULL OR NOT public.can_access_site(v_uid, v_conversation.site_id) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.conversations
  SET stage = 'follow_up_waiting',
      next_follow_up_at = p_next_follow_up_at,
      note = COALESCE(v_note, note),
      last_note_preview = CASE WHEN v_note IS NULL THEN last_note_preview ELSE LEFT(v_note, 240) END,
      last_activity_at = v_now,
      updated_at = v_now
  WHERE id = v_conversation.id
  RETURNING * INTO v_conversation;

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
    'follow_up_set',
    CASE WHEN v_is_service THEN 'system' ELSE 'user' END,
    CASE WHEN v_is_service THEN NULL ELSE v_uid END,
    jsonb_build_object(
      'next_follow_up_at', p_next_follow_up_at,
      'note_present', v_note IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'id', v_conversation.id,
    'stage', v_conversation.stage,
    'next_follow_up_at', v_conversation.next_follow_up_at,
    'updated_at', v_conversation.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.conversation_change_stage_v1(
  p_conversation_id uuid,
  p_stage text,
  p_next_follow_up_at timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service boolean := (v_uid IS NULL AND public._jwt_role() = 'service_role');
  v_conversation public.conversations%ROWTYPE;
  v_now timestamptz := now();
  v_stage text := NULLIF(btrim(p_stage), '');
  v_note text := NULLIF(btrim(p_note), '');
  v_follow_up timestamptz;
BEGIN
  IF v_stage IS NULL OR v_stage NOT IN ('new', 'contacted', 'qualified', 'proposal_sent', 'follow_up_waiting') THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_stage', ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_conversation
  FROM public.conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'conversation_not_found', ERRCODE = 'P0001';
  END IF;

  IF v_conversation.stage IN ('won', 'lost', 'junk') THEN
    RAISE EXCEPTION USING MESSAGE = 'conversation_not_actionable', ERRCODE = 'P0001';
  END IF;

  IF NOT v_is_service THEN
    IF v_uid IS NULL OR NOT public.can_access_site(v_uid, v_conversation.site_id) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
    END IF;
  END IF;

  v_follow_up := COALESCE(p_next_follow_up_at, v_conversation.next_follow_up_at, v_now + interval '1 hour');
  IF v_follow_up < v_conversation.created_at THEN
    RAISE EXCEPTION USING MESSAGE = 'follow_up_before_create', ERRCODE = 'P0001';
  END IF;

  UPDATE public.conversations
  SET stage = v_stage,
      status = 'OPEN',
      next_follow_up_at = v_follow_up,
      last_contact_at = CASE
        WHEN v_stage IN ('contacted', 'qualified', 'proposal_sent') THEN v_now
        ELSE last_contact_at
      END,
      note = COALESCE(v_note, note),
      last_note_preview = CASE WHEN v_note IS NULL THEN last_note_preview ELSE LEFT(v_note, 240) END,
      last_activity_at = v_now,
      updated_at = v_now
  WHERE id = v_conversation.id
  RETURNING * INTO v_conversation;

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
    'stage_changed',
    CASE WHEN v_is_service THEN 'system' ELSE 'user' END,
    CASE WHEN v_is_service THEN NULL ELSE v_uid END,
    jsonb_build_object(
      'stage', v_stage,
      'next_follow_up_at', v_follow_up,
      'note_present', v_note IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'id', v_conversation.id,
    'status', v_conversation.status,
    'stage', v_conversation.stage,
    'next_follow_up_at', v_conversation.next_follow_up_at,
    'last_contact_at', v_conversation.last_contact_at,
    'updated_at', v_conversation.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.conversation_reopen_v1(
  p_conversation_id uuid,
  p_stage text DEFAULT 'follow_up_waiting',
  p_next_follow_up_at timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service boolean := (v_uid IS NULL AND public._jwt_role() = 'service_role');
  v_conversation public.conversations%ROWTYPE;
  v_now timestamptz := now();
  v_stage text := COALESCE(NULLIF(btrim(p_stage), ''), 'follow_up_waiting');
  v_note text := NULLIF(btrim(p_note), '');
  v_follow_up timestamptz := COALESCE(p_next_follow_up_at, v_now + interval '1 hour');
BEGIN
  IF v_stage NOT IN ('new', 'contacted', 'qualified', 'proposal_sent', 'follow_up_waiting') THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_stage', ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_conversation
  FROM public.conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'conversation_not_found', ERRCODE = 'P0001';
  END IF;

  IF v_conversation.stage NOT IN ('won', 'lost', 'junk') THEN
    RAISE EXCEPTION USING MESSAGE = 'conversation_not_reopenable', ERRCODE = 'P0001';
  END IF;

  IF NOT v_is_service THEN
    IF v_uid IS NULL OR NOT public.can_access_site(v_uid, v_conversation.site_id) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_follow_up < v_conversation.created_at THEN
    RAISE EXCEPTION USING MESSAGE = 'follow_up_before_create', ERRCODE = 'P0001';
  END IF;

  UPDATE public.conversations
  SET status = 'OPEN',
      stage = v_stage,
      next_follow_up_at = v_follow_up,
      note = COALESCE(v_note, note),
      last_note_preview = CASE WHEN v_note IS NULL THEN last_note_preview ELSE LEFT(v_note, 240) END,
      last_activity_at = v_now,
      updated_at = v_now
  WHERE id = v_conversation.id
  RETURNING * INTO v_conversation;

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
    'reopened',
    CASE WHEN v_is_service THEN 'system' ELSE 'user' END,
    CASE WHEN v_is_service THEN NULL ELSE v_uid END,
    jsonb_build_object(
      'stage', v_stage,
      'next_follow_up_at', v_follow_up,
      'note_present', v_note IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'id', v_conversation.id,
    'status', v_conversation.status,
    'stage', v_conversation.stage,
    'next_follow_up_at', v_conversation.next_follow_up_at,
    'updated_at', v_conversation.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.conversation_link_entity_v1(
  p_conversation_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service boolean := (v_uid IS NULL AND public._jwt_role() = 'service_role');
  v_conversation public.conversations%ROWTYPE;
  v_now timestamptz := now();
  v_entity_type text := NULLIF(btrim(p_entity_type), '');
  v_link_id uuid;
  v_call_session_id uuid;
  v_call_phone text;
BEGIN
  IF v_entity_type IS NULL OR v_entity_type NOT IN ('session', 'call', 'event') THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_entity_type', ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_conversation
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

  IF v_entity_type = 'call' THEN
    SELECT
      ca.matched_session_id,
      NULLIF(BTRIM(regexp_replace(COALESCE(ca.caller_phone_e164, ca.intent_target, ca.phone_number), '[^0-9+]', '', 'g')), '')
    INTO v_call_session_id, v_call_phone
    FROM public.calls ca
    WHERE ca.id = p_entity_id
      AND ca.site_id = v_conversation.site_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'entity_site_mismatch', ERRCODE = 'P0001';
    END IF;
  ELSIF v_entity_type = 'session' THEN
    PERFORM 1
    FROM public.sessions s
    WHERE s.id = p_entity_id
      AND s.site_id = v_conversation.site_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'entity_site_mismatch', ERRCODE = 'P0001';
    END IF;
  ELSE
    PERFORM 1
    FROM public.events e
    WHERE e.id = p_entity_id
      AND e.site_id = v_conversation.site_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'entity_site_mismatch', ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.conversation_links (
    conversation_id,
    entity_type,
    entity_id
  )
  VALUES (
    v_conversation.id,
    v_entity_type,
    p_entity_id
  )
  ON CONFLICT (conversation_id, entity_type, entity_id) DO NOTHING
  RETURNING id INTO v_link_id;

  IF v_link_id IS NOT NULL THEN
    UPDATE public.conversations
    SET primary_call_id = CASE
          WHEN v_entity_type = 'call' THEN COALESCE(primary_call_id, p_entity_id)
          ELSE primary_call_id
        END,
        primary_session_id = CASE
          WHEN v_entity_type = 'session' THEN COALESCE(primary_session_id, p_entity_id)
          WHEN v_entity_type = 'call' THEN COALESCE(primary_session_id, v_call_session_id)
          ELSE primary_session_id
        END,
        phone_e164 = CASE
          WHEN v_entity_type = 'call' THEN COALESCE(phone_e164, v_call_phone)
          ELSE phone_e164
        END,
        last_activity_at = v_now,
        updated_at = v_now
    WHERE id = v_conversation.id
    RETURNING * INTO v_conversation;

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
      'source_merged',
      CASE WHEN v_is_service THEN 'system' ELSE 'user' END,
      CASE WHEN v_is_service THEN NULL ELSE v_uid END,
      jsonb_build_object(
        'entity_type', v_entity_type,
        'entity_id', p_entity_id
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'conversation_id', v_conversation.id,
    'entity_type', v_entity_type,
    'entity_id', p_entity_id,
    'linked', v_link_id IS NOT NULL
  );
END;
$$;

COMMENT ON FUNCTION public.get_conversation_inbox_v1(uuid, text, text, uuid, integer, integer, text) IS
  'Returns conversation inbox rows plus summary counters for active, overdue, today, and unassigned buckets.';
COMMENT ON FUNCTION public.get_conversation_detail_v1(uuid) IS
  'Returns one conversation, its timeline, links, sales, and primary linked entities.';
COMMENT ON FUNCTION public.conversation_assign_v1(uuid, uuid) IS
  'Assigns or unassigns a conversation and appends an assignment_changed timeline event.';
COMMENT ON FUNCTION public.conversation_add_note_v1(uuid, text) IS
  'Stores the latest note preview on the conversation and appends a note_added event.';
COMMENT ON FUNCTION public.conversation_set_follow_up_v1(uuid, timestamptz, text) IS
  'Sets follow-up timing for an active conversation and appends a follow_up_set event.';
COMMENT ON FUNCTION public.conversation_change_stage_v1(uuid, text, timestamptz, text) IS
  'Moves an OPEN conversation across non-terminal stages and appends a stage_changed event.';
COMMENT ON FUNCTION public.conversation_reopen_v1(uuid, text, timestamptz, text) IS
  'Reopens a terminal conversation into an active stage and appends a reopened event.';
COMMENT ON FUNCTION public.conversation_link_entity_v1(uuid, text, uuid) IS
  'Links a session/call/event to a conversation inside the DB kernel and appends a source_merged event.';

REVOKE ALL ON FUNCTION public.get_conversation_inbox_v1(uuid, text, text, uuid, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_conversation_detail_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.conversation_assign_v1(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.conversation_add_note_v1(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.conversation_set_follow_up_v1(uuid, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.conversation_change_stage_v1(uuid, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.conversation_reopen_v1(uuid, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.conversation_link_entity_v1(uuid, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_conversation_inbox_v1(uuid, text, text, uuid, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_inbox_v1(uuid, text, text, uuid, integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_conversation_detail_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_detail_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.conversation_assign_v1(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversation_assign_v1(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.conversation_add_note_v1(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversation_add_note_v1(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.conversation_set_follow_up_v1(uuid, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversation_set_follow_up_v1(uuid, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.conversation_change_stage_v1(uuid, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversation_change_stage_v1(uuid, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.conversation_reopen_v1(uuid, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversation_reopen_v1(uuid, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.conversation_link_entity_v1(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversation_link_entity_v1(uuid, text, uuid) TO service_role;

COMMIT;
