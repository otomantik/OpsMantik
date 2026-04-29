BEGIN;

CREATE OR REPLACE FUNCTION public.get_session_timeline(
  p_site_id uuid,
  p_session_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  event_category text,
  event_action text,
  event_label text,
  url text,
  metadata jsonb,
  source_kind text,
  ledger_action_type text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH timeline_union AS (
    SELECT
      e.id,
      e.created_at,
      e.event_category,
      e.event_action,
      e.event_label,
      e.url,
      e.metadata,
      'event'::text AS source_kind,
      NULL::text AS ledger_action_type
    FROM public.events e
    JOIN public.sessions s
      ON s.id = e.session_id
     AND s.site_id = e.site_id
    WHERE e.site_id = p_site_id
      AND e.session_id = p_session_id
      AND public.is_ads_session(s)
      AND public._can_access_site(p_site_id)

    UNION ALL

    SELECT
      l.id,
      l.created_at,
      'intent'::text AS event_category,
      coalesce(nullif(l.intent_action, ''), 'session_intent') AS event_action,
      l.intent_target AS event_label,
      l.intent_page_url AS url,
      coalesce(l.metadata, '{}'::jsonb) || jsonb_build_object('source', l.source, 'call_id', l.call_id) AS metadata,
      'ledger'::text AS source_kind,
      l.intent_action::text AS ledger_action_type
    FROM public.session_intent_actions_ledger l
    JOIN public.sessions s
      ON s.id = l.session_id
     AND s.site_id = l.site_id
    WHERE l.site_id = p_site_id
      AND l.session_id = p_session_id
      AND public.is_ads_session(s)
      AND public._can_access_site(p_site_id)
  )
  SELECT
    t.id,
    t.created_at,
    t.event_category,
    t.event_action,
    t.event_label,
    t.url,
    t.metadata,
    t.source_kind,
    t.ledger_action_type
  FROM timeline_union t
  ORDER BY t.created_at DESC, t.id DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 100), 500));
$$;

REVOKE ALL ON FUNCTION public.get_session_timeline(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_session_timeline(uuid, uuid, integer) TO authenticated, service_role;

COMMIT;
