-- =============================================================================
-- OCI Phase 1: Transactional Outbox — outbox_events table and claim RPC
-- Eradicates dual-write: seal API writes one row here in same tx as call update;
-- worker processes PENDING rows and writes to marketing_signals / offline_conversion_queue.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) outbox_events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL DEFAULT 'IntentSealed',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  call_id uuid REFERENCES public.calls(id) ON DELETE SET NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempt_count int NOT NULL DEFAULT 0,
  last_error text
);

COMMENT ON TABLE public.outbox_events IS
  'Transactional outbox for OCI: IntentSealed written in same tx as call seal; worker consumes and writes marketing_signals / queue.';

CREATE INDEX IF NOT EXISTS idx_outbox_events_pending
  ON public.outbox_events(created_at ASC)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_outbox_events_site_status
  ON public.outbox_events(site_id, status);

-- RLS: only service_role may read/write (cron and app server)
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY outbox_events_service_role_only ON public.outbox_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- -----------------------------------------------------------------------------
-- 2) claim_outbox_events — SELECT FOR UPDATE SKIP LOCKED, mark PROCESSING, return rows
-- Called by outbox worker cron. Locks and claims up to p_limit PENDING rows.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_outbox_events(p_limit int DEFAULT 50)
RETURNS TABLE(
  id uuid,
  payload jsonb,
  call_id uuid,
  site_id uuid,
  created_at timestamptz,
  attempt_count int
)
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
    FROM public.outbox_events o
    WHERE o.status = 'PENDING'
    ORDER BY o.created_at ASC
    LIMIT greatest(1, least(p_limit, 200))
    FOR UPDATE OF o SKIP LOCKED
  ),
  updated AS (
    UPDATE public.outbox_events o
    SET status = 'PROCESSING', attempt_count = o.attempt_count + 1
    FROM locked l
    WHERE o.id = l.id
    RETURNING o.id, o.payload, o.call_id, o.site_id, o.created_at, o.attempt_count
  )
  SELECT u.id, u.payload, u.call_id, u.site_id, u.created_at, u.attempt_count FROM updated u;
END;
$$;

COMMENT ON FUNCTION public.claim_outbox_events(int) IS
  'OCI outbox worker: claim PENDING rows (FOR UPDATE SKIP LOCKED), set PROCESSING, return for app to handle.';

GRANT EXECUTE ON FUNCTION public.claim_outbox_events(int) TO service_role;

COMMIT;
