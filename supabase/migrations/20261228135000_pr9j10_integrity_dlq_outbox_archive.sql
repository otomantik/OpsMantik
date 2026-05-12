-- PR-9J.10: remaining OCI zero-tolerance DB hardening.

BEGIN;

-- Forensic ledger must outlive accidental queue deletes.
ALTER TABLE public.oci_queue_transitions
  DROP CONSTRAINT IF EXISTS oci_queue_transitions_queue_id_fkey;
ALTER TABLE public.oci_queue_transitions
  ADD CONSTRAINT oci_queue_transitions_queue_id_fkey
  FOREIGN KEY (queue_id) REFERENCES public.offline_conversion_queue(id) ON DELETE RESTRICT;

ALTER TABLE public.offline_conversion_queue
  DROP CONSTRAINT IF EXISTS offline_conversion_queue_site_id_fkey;
ALTER TABLE public.offline_conversion_queue
  ADD CONSTRAINT offline_conversion_queue_site_id_fkey
  FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;

ALTER TABLE public.offline_conversion_queue
  ADD CONSTRAINT offline_conversion_queue_call_id_fkey
  FOREIGN KEY (call_id) REFERENCES public.calls(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED NOT VALID;

ALTER TABLE public.offline_conversion_queue
  ADD CONSTRAINT offline_conversion_queue_source_outbox_event_id_fkey
  FOREIGN KEY (source_outbox_event_id) REFERENCES public.outbox_events(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED NOT VALID;

ALTER TABLE public.offline_conversion_queue
  VALIDATE CONSTRAINT offline_conversion_queue_external_id_shape_chk;

CREATE OR REPLACE VIEW public.oci_outbox_failed_breakdown_v1
WITH (security_invoker = true) AS
SELECT
  site_id,
  event_type,
  last_error,
  count(*)::integer AS failed_count,
  max(updated_at) AS latest_failed_at
FROM public.outbox_events
WHERE status = 'FAILED'
GROUP BY site_id, event_type, last_error;

REVOKE ALL ON public.oci_outbox_failed_breakdown_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.oci_outbox_failed_breakdown_v1 TO service_role;

CREATE TABLE IF NOT EXISTS public.offline_conversion_queue_archive (
  id uuid PRIMARY KEY,
  archived_at timestamptz NOT NULL DEFAULT now(),
  row_snapshot jsonb NOT NULL
);

ALTER TABLE public.offline_conversion_queue_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offline_conversion_queue_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.offline_conversion_queue_archive TO service_role;

CREATE OR REPLACE FUNCTION public.archive_failed_conversions_batch(
  p_days_old integer DEFAULT 30,
  p_limit integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  WITH candidates AS (
    SELECT q.*
    FROM public.offline_conversion_queue q
    WHERE q.status IN ('FAILED', 'DEAD_LETTER_QUARANTINE')
      AND q.updated_at < now() - (GREATEST(COALESCE(p_days_old, 30), 1) || ' days')::interval
    ORDER BY q.updated_at
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  )
  INSERT INTO public.offline_conversion_queue_archive(id, row_snapshot)
  SELECT c.id, to_jsonb(c)
  FROM candidates c
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.escalate_exhausted_to_dlq_v1(
  p_max_attempts integer DEFAULT 5,
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_ids uuid[] := ARRAY[]::uuid[];
  v_count integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
  INTO v_ids
  FROM (
    SELECT id
    FROM public.offline_conversion_queue
    WHERE provider_key = 'google_ads'
      AND status = 'FAILED'
      AND attempt_count >= GREATEST(COALESCE(p_max_attempts, 5), 1)
      AND COALESCE(provider_error_category, '') IN ('TERMINAL', 'DETERMINISTIC_SKIP')
    ORDER BY updated_at
    LIMIT GREATEST(COALESCE(p_limit, 500), 1)
  ) s;

  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  SELECT public.append_worker_transition_batch_v2(
    v_ids,
    'DEAD_LETTER_QUARANTINE',
    now(),
    jsonb_build_object(
      'reason', 'ATTEMPT_CAP_EXHAUSTED',
      'actor', 'escalate_exhausted_to_dlq_v1',
      'last_error', 'ATTEMPT_CAP_EXHAUSTED'
    )
  )
  INTO v_count;

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.archive_failed_conversions_batch(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_failed_conversions_batch(integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.escalate_exhausted_to_dlq_v1(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.escalate_exhausted_to_dlq_v1(integer, integer) TO service_role;

COMMIT;
