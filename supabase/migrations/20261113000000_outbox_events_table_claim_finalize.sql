-- OCI transactional outbox: table + worker claim RPC + finalize RPC.
-- Mirrors schema_utf8.sql; production drift (PGRST205) had no migrations for this previously.

BEGIN;

CREATE TABLE IF NOT EXISTS public.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL DEFAULT 'IntentSealed',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  call_id uuid REFERENCES public.calls (id) ON DELETE SET NULL,
  site_id uuid NOT NULL REFERENCES public.sites (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_events_status_check CHECK (
    status = ANY (
      ARRAY[
        'PENDING'::text,
        'PROCESSING'::text,
        'PROCESSED'::text,
        'FAILED'::text
      ]
    )
  )
);

COMMENT ON TABLE public.outbox_events IS 'Transactional outbox for OCI: IntentSealed written after RPC; worker consumes and writes marketing_signals / queue.';

CREATE INDEX IF NOT EXISTS idx_outbox_events_pending ON public.outbox_events USING btree (created_at)
WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_outbox_events_site_call_id ON public.outbox_events USING btree (site_id, call_id)
WHERE call_id IS NOT NULL;

COMMENT ON INDEX idx_outbox_events_site_call_id IS 'Hot-path: per-call OCI artifact invalidation (junk/restore flows).';

CREATE INDEX IF NOT EXISTS idx_outbox_events_site_status ON public.outbox_events USING btree (site_id, status);

ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outbox_events_service_role_only ON public.outbox_events;
CREATE POLICY outbox_events_service_role_only ON public.outbox_events FOR ALL USING (
  auth.role () = 'service_role'
)
WITH CHECK (
  auth.role () = 'service_role'
);

-- ---------------------------------------------------------------------------
-- claim_outbox_events: PENDING → PROCESSING (+ attempt_count bump, SKIP LOCKED)
-- ---------------------------------------------------------------------------
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

COMMENT ON FUNCTION public.claim_outbox_events(integer)
IS 'OCI outbox worker: claim PENDING rows (FOR UPDATE SKIP LOCKED), set PROCESSING + updated_at, return for app to handle.';

-- ---------------------------------------------------------------------------
-- finalize_outbox_event_v1: terminal or retry (PENDING) after PROCESSING claim
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_outbox_event_v1(
  p_outbox_id uuid,
  p_status text,
  p_last_error text DEFAULT NULL,
  p_attempt_count integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'finalize_outbox_event_v1 may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (p_status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED')) THEN
    RAISE EXCEPTION 'finalize_outbox_event_v1: invalid status %', p_status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.outbox_events AS o
  SET
    status = p_status,
    processed_at =
      CASE
        WHEN p_status = 'PROCESSED' THEN now()
        ELSE NULL
      END,
    last_error =
      CASE
        WHEN p_status = 'PROCESSED' THEN NULL
        ELSE LEFT(p_last_error, 8192)
      END,
    attempt_count = COALESCE(p_attempt_count, o.attempt_count),
    updated_at = now()
  WHERE o.id = p_outbox_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finalize_outbox_event_v1: outbox row % not found', p_outbox_id USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.finalize_outbox_event_v1(uuid, text, text, integer)
IS 'OCI outbox: mark PROCESSING row PROCESSED/FAILED/PENDING retry; clears processed_at unless PROCESSED.';

REVOKE ALL ON FUNCTION public.claim_outbox_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_outbox_events(integer) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_outbox_event_v1(uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_outbox_event_v1(uuid, text, text, integer) TO service_role;

REVOKE ALL ON TABLE public.outbox_events FROM PUBLIC;
REVOKE ALL ON TABLE public.outbox_events FROM anon, authenticated;
GRANT ALL ON TABLE public.outbox_events TO service_role;

COMMIT;
