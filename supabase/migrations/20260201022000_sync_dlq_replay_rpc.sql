-- =============================================================================
-- SYNC DLQ REPLAY RPC: atomic replay bookkeeping
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_dlq_record_replay(p_id uuid, p_error text DEFAULT NULL)
RETURNS TABLE(id uuid, replay_count integer, last_replay_at timestamptz, last_replay_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.sync_dlq
  SET
    replay_count = COALESCE(replay_count, 0) + 1,
    last_replay_at = NOW(),
    last_replay_error = p_error
  WHERE public.sync_dlq.id = p_id
  RETURNING public.sync_dlq.id, public.sync_dlq.replay_count, public.sync_dlq.last_replay_at, public.sync_dlq.last_replay_error
  INTO id, replay_count, last_replay_at, last_replay_error;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING MESSAGE = 'DLQ row not found';
  END IF;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.sync_dlq_record_replay(uuid, text) IS 'Atomic replay bookkeeping for sync_dlq: increments replay_count and stores last_replay_* fields.';

