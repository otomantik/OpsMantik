-- Migration: Event-Sourcing Lite — get_activity_feed_v1 RPC
-- Date: 2026-02-05
--
-- Purpose:
-- - Unified, DB-backed activity log for Kill Feed / Activity Log module.
-- - Includes manual + automation actions (action_type) with actor attribution.
-- - Cursor-based pagination (created_at + id).
--
-- Security:
-- - SECURITY INVOKER; RLS on call_actions/calls enforces tenant access.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_activity_feed_v1(
  p_site_id uuid,
  p_hours_back integer DEFAULT 24,
  p_limit integer DEFAULT 50,
  p_action_types text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from timestamptz;
  v_rows jsonb;
  v_limit int;
BEGIN
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  v_from := now() - (COALESCE(p_hours_back, 24) || ' hours')::interval;

  WITH base AS (
    SELECT
      a.id,
      a.call_id,
      a.action_type,
      a.actor_type,
      a.actor_id,
      a.previous_status,
      a.new_status,
      a.metadata,
      a.created_at,
      c.intent_action,
      c.intent_target,
      c.lead_score,
      c.sale_amount,
      c.currency,
      COALESCE(a.metadata->'meta'->>'reason', a.metadata->>'reason') AS reason,
      (a.id = (
        SELECT a2.id
        FROM public.call_actions a2
        WHERE a2.call_id = a.call_id
        ORDER BY a2.created_at DESC, a2.id DESC
        LIMIT 1
      )) AS is_latest_for_call
    FROM public.call_actions a
    JOIN public.calls c ON c.id = a.call_id
    WHERE a.site_id = p_site_id
      AND a.created_at >= v_from
      AND (p_action_types IS NULL OR a.action_type = ANY(p_action_types))
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT v_limit
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'call_id', call_id,
      'action_type', action_type,
      'actor_type', actor_type,
      'actor_id', actor_id,
      'previous_status', previous_status,
      'new_status', new_status,
      'created_at', created_at,
      'intent_action', intent_action,
      'intent_target', intent_target,
      'lead_score', lead_score,
      'sale_amount', sale_amount,
      'currency', currency,
      'reason', reason,
      'is_latest_for_call', is_latest_for_call
    )
    ORDER BY created_at DESC
  )
  INTO v_rows
  FROM base;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_activity_feed_v1(uuid, integer, integer, text[]) IS
'Returns recent call_actions for a site to power Activity Log / Kill Feed module (manual + automation).';

REVOKE ALL ON FUNCTION public.get_activity_feed_v1(uuid, integer, integer, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_activity_feed_v1(uuid, integer, integer, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_activity_feed_v1(uuid, integer, integer, text[]) TO service_role;

COMMIT;

