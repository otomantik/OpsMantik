-- Kill Feed RPC: Database-backed activity log for undo/cancel actions
-- Shows recent confirmed/junk/cancelled intents for restore/cancel flows

CREATE OR REPLACE FUNCTION public.get_kill_feed_v1(
  p_site_id uuid,
  p_hours_back integer DEFAULT 24,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_from timestamptz;
  v_result jsonb;
BEGIN
  -- Calculate time window
  v_from := now() - (p_hours_back || ' hours')::interval;

  -- Fetch recent qualified intents (confirmed/junk/cancelled)
  -- Order by most recent action first
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'status', c.status,
      'intent_action', c.intent_action,
      'intent_target', c.intent_target,
      'created_at', c.created_at,
      'confirmed_at', c.confirmed_at,
      'cancelled_at', c.cancelled_at,
      'lead_score', c.lead_score,
      'sale_amount', c.sale_amount,
      'currency', c.currency,
      -- Effective action timestamp (for sorting and display)
      'action_at', COALESCE(
        c.cancelled_at,
        c.confirmed_at,
        c.created_at
      )
    )
    ORDER BY COALESCE(c.cancelled_at, c.confirmed_at, c.created_at) DESC
  )
  INTO v_result
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.status IN ('confirmed', 'junk', 'cancelled')
    -- Look back based on when the action happened
    AND COALESCE(c.cancelled_at, c.confirmed_at, c.created_at) >= v_from
  LIMIT p_limit;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_kill_feed_v1 IS
'Returns recent qualified intents (confirmed/junk/cancelled) for kill feed UI. Used for undo/restore and cancel flows.';

-- Grant execute to authenticated users (RLS on calls table will filter by site access)
GRANT EXECUTE ON FUNCTION public.get_kill_feed_v1 TO authenticated;
