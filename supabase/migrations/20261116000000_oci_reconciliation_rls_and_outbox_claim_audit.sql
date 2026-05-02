-- OCI hardening: reconciliation RLS + site/reason index + outbox claim audit timestamp.

BEGIN;

-- ---------------------------------------------------------------------------
-- oci_reconciliation_events: RLS policies + grants for PostgREST safety
-- ---------------------------------------------------------------------------
ALTER TABLE public.oci_reconciliation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oci_reconciliation_events_select_site_members ON public.oci_reconciliation_events;
CREATE POLICY oci_reconciliation_events_select_site_members
ON public.oci_reconciliation_events
FOR SELECT
USING (public._can_access_site(site_id));

DROP POLICY IF EXISTS oci_reconciliation_events_write_service_role ON public.oci_reconciliation_events;
CREATE POLICY oci_reconciliation_events_write_service_role
ON public.oci_reconciliation_events
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON TABLE public.oci_reconciliation_events FROM PUBLIC;
REVOKE ALL ON TABLE public.oci_reconciliation_events FROM anon;
REVOKE ALL ON TABLE public.oci_reconciliation_events FROM authenticated;
GRANT ALL ON TABLE public.oci_reconciliation_events TO service_role;
GRANT SELECT ON TABLE public.oci_reconciliation_events TO authenticated;

-- ---------------------------------------------------------------------------
-- Reconciliation coverage queries: site + reason + created_at bucket index
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS oci_reconciliation_events_site_reason_created_idx
  ON public.oci_reconciliation_events (site_id, reason, created_at DESC);

-- ---------------------------------------------------------------------------
-- outbox_events: audit timestamp for currently processing claims
-- ---------------------------------------------------------------------------
ALTER TABLE public.outbox_events
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

COMMENT ON COLUMN public.outbox_events.processing_started_at
IS 'Timestamp set when claim_outbox_events flips status to PROCESSING; cleared when finalized away from PROCESSING.';

-- Keep claim RPC as the single source of PROCESSING transition semantics.
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
      processing_started_at = now(),
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

-- Clear processing_started_at when row leaves PROCESSING.
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
    processing_started_at =
      CASE
        WHEN p_status = 'PROCESSING' THEN COALESCE(o.processing_started_at, now())
        ELSE NULL
      END,
    attempt_count = COALESCE(p_attempt_count, o.attempt_count),
    updated_at = now()
  WHERE o.id = p_outbox_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finalize_outbox_event_v1: outbox row % not found', p_outbox_id USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMIT;
