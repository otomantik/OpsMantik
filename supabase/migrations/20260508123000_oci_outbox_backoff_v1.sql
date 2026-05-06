-- Phase 24: Exponential Back-off for OCI Outbox
-- Prevents rapid retry exhaustion before attribution matching completes.

CREATE OR REPLACE FUNCTION public.claim_outbox_events(p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, payload jsonb, call_id uuid, site_id uuid, created_at timestamptz, attempt_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'claim_outbox_events may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH locked AS (
    SELECT o.id
    FROM public.outbox_events AS o
    WHERE o.status = 'PENDING'
      AND (
        o.attempt_count = 0 
        OR o.updated_at + (pow(2, o.attempt_count) * interval '1 minute') <= now()
      )
    ORDER BY o.created_at ASC
    LIMIT greatest(1, least(p_limit, 200))
    FOR UPDATE OF o SKIP LOCKED
  ),
  updated AS (
    UPDATE public.outbox_events AS o
    SET
      status = 'PROCESSING',
      attempt_count = o.attempt_count + 1,
      updated_at = now()
    FROM locked AS l
    WHERE o.id = l.id
    RETURNING o.id, o.payload, o.call_id, o.site_id, o.created_at, o.attempt_count
  )
  SELECT u.id, u.payload, u.call_id, u.site_id, u.created_at, u.attempt_count
  FROM updated AS u
  ORDER BY u.created_at ASC, u.id ASC;
END;
$$;
