BEGIN;

CREATE TABLE IF NOT EXISTS public.oci_queue_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id uuid NOT NULL REFERENCES public.offline_conversion_queue(id) ON DELETE CASCADE,
  new_status text NOT NULL,
  error_payload jsonb,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oci_queue_transitions_new_status_check CHECK (
    new_status IN (
      'QUEUED',
      'RETRY',
      'PROCESSING',
      'UPLOADED',
      'COMPLETED',
      'COMPLETED_UNVERIFIED',
      'FAILED',
      'DEAD_LETTER_QUARANTINE'
    )
  ),
  CONSTRAINT oci_queue_transitions_actor_check CHECK (
    actor IN (
      'SCRIPT',
      'WORKER',
      'RPC_CLAIM',
      'SWEEPER',
      'MANUAL',
      'SYSTEM_BACKFILL'
    )
  )
);

COMMENT ON TABLE public.oci_queue_transitions IS
  'Phase 22 immutable ledger for offline_conversion_queue state transitions.';
COMMENT ON COLUMN public.oci_queue_transitions.error_payload IS
  'Partial snapshot patch. Null values do not clear fields; use clear_fields array for explicit clears.';

CREATE INDEX IF NOT EXISTS idx_oci_queue_transitions_queue_created_at
  ON public.oci_queue_transitions (queue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oci_queue_transitions_created_at
  ON public.oci_queue_transitions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oci_queue_transitions_queue_id_desc
  ON public.oci_queue_transitions (queue_id, id DESC);

-- Phase 22 focuses on the write-model transition. Keep RLS disabled here until
-- explicit read policies are introduced for panel/API consumers.
ALTER TABLE public.oci_queue_transitions DISABLE ROW LEVEL SECURITY;

GRANT ALL ON public.oci_queue_transitions TO service_role;

CREATE OR REPLACE FUNCTION public.queue_transition_payload_has_meaningful_patch(p_payload jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN false
      ELSE (
        EXISTS (
          SELECT 1
          FROM jsonb_each(p_payload) AS entry
          WHERE entry.key IN (
            'last_error',
            'provider_error_code',
            'provider_error_category',
            'attempt_count',
            'retry_count',
            'next_retry_at',
            'uploaded_at',
            'claimed_at',
            'provider_request_id',
            'provider_ref'
          )
            AND entry.value IS DISTINCT FROM 'null'::jsonb
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
            CASE
              WHEN p_payload ? 'clear_fields' AND jsonb_typeof(p_payload->'clear_fields') = 'array'
                THEN p_payload->'clear_fields'
              ELSE '[]'::jsonb
            END
          ) AS clear_field
          WHERE clear_field.value IN (
            'last_error',
            'provider_error_code',
            'provider_error_category',
            'next_retry_at',
            'uploaded_at',
            'claimed_at',
            'provider_request_id',
            'provider_ref'
          )
        )
      )
    END;
$$;

COMMENT ON FUNCTION public.queue_transition_payload_has_meaningful_patch(jsonb) IS
  'Returns true when a transition payload contains at least one supported non-null patch key or explicit clear_fields.';

CREATE OR REPLACE FUNCTION public.apply_oci_queue_transition_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_queue public.offline_conversion_queue%ROWTYPE;
  v_payload jsonb := NEW.error_payload;
  v_clear_fields text[] := ARRAY[]::text[];
  v_invalid_clear_field text;
  v_has_meaningful_patch boolean := false;
  v_is_same_status boolean := false;
BEGIN
  IF v_payload IS NOT NULL AND jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'oci_queue_transitions.error_payload must be a JSON object or null';
  END IF;

  SELECT *
  INTO v_queue
  FROM public.offline_conversion_queue
  WHERE id = NEW.queue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Queue row not found for transition %: queue %', NEW.id, NEW.queue_id;
  END IF;

  IF v_payload ? 'clear_fields' THEN
    IF jsonb_typeof(v_payload->'clear_fields') <> 'array' THEN
      RAISE EXCEPTION 'oci_queue_transitions.error_payload.clear_fields must be an array';
    END IF;

    SELECT COALESCE(array_agg(value), ARRAY[]::text[])
    INTO v_clear_fields
    FROM jsonb_array_elements_text(v_payload->'clear_fields') AS clear_field;

    SELECT field_name
    INTO v_invalid_clear_field
    FROM unnest(v_clear_fields) AS field_name
    WHERE field_name NOT IN (
      'last_error',
      'provider_error_code',
      'provider_error_category',
      'next_retry_at',
      'uploaded_at',
      'claimed_at',
      'provider_request_id',
      'provider_ref'
    )
    LIMIT 1;

    IF v_invalid_clear_field IS NOT NULL THEN
      RAISE EXCEPTION 'Unsupported clear_fields value in oci_queue_transitions.error_payload: %', v_invalid_clear_field;
    END IF;
  END IF;

  v_has_meaningful_patch := public.queue_transition_payload_has_meaningful_patch(v_payload);
  v_is_same_status := NEW.new_status = v_queue.status;

  IF v_is_same_status AND NOT v_has_meaningful_patch THEN
    RAISE EXCEPTION 'NOOP_TRANSITION: transition % queue % already in status %', NEW.id, NEW.queue_id, NEW.new_status;
  END IF;

  UPDATE public.offline_conversion_queue AS q
  SET
    status = NEW.new_status,
    updated_at = NEW.created_at,
    last_error = CASE
      WHEN 'last_error' = ANY(v_clear_fields) THEN NULL
      WHEN v_payload ? 'last_error' AND v_payload->>'last_error' IS NOT NULL THEN v_payload->>'last_error'
      ELSE q.last_error
    END,
    provider_error_code = CASE
      WHEN 'provider_error_code' = ANY(v_clear_fields) THEN NULL
      WHEN v_payload ? 'provider_error_code' AND v_payload->>'provider_error_code' IS NOT NULL THEN v_payload->>'provider_error_code'
      ELSE q.provider_error_code
    END,
    provider_error_category = CASE
      WHEN 'provider_error_category' = ANY(v_clear_fields) THEN NULL
      WHEN v_payload ? 'provider_error_category' AND v_payload->>'provider_error_category' IS NOT NULL THEN v_payload->>'provider_error_category'
      ELSE q.provider_error_category
    END,
    attempt_count = CASE
      WHEN v_payload ? 'attempt_count' AND v_payload->>'attempt_count' IS NOT NULL THEN (v_payload->>'attempt_count')::int
      ELSE q.attempt_count
    END,
    retry_count = CASE
      WHEN v_payload ? 'retry_count' AND v_payload->>'retry_count' IS NOT NULL THEN (v_payload->>'retry_count')::int
      ELSE q.retry_count
    END,
    next_retry_at = CASE
      WHEN 'next_retry_at' = ANY(v_clear_fields) THEN NULL
      WHEN v_payload ? 'next_retry_at' AND v_payload->>'next_retry_at' IS NOT NULL THEN (v_payload->>'next_retry_at')::timestamptz
      ELSE q.next_retry_at
    END,
    uploaded_at = CASE
      WHEN 'uploaded_at' = ANY(v_clear_fields) THEN NULL
      WHEN v_payload ? 'uploaded_at' AND v_payload->>'uploaded_at' IS NOT NULL THEN (v_payload->>'uploaded_at')::timestamptz
      ELSE q.uploaded_at
    END,
    claimed_at = CASE
      WHEN 'claimed_at' = ANY(v_clear_fields) THEN NULL
      WHEN v_payload ? 'claimed_at' AND v_payload->>'claimed_at' IS NOT NULL THEN (v_payload->>'claimed_at')::timestamptz
      ELSE q.claimed_at
    END,
    provider_request_id = CASE
      WHEN 'provider_request_id' = ANY(v_clear_fields) THEN NULL
      WHEN v_payload ? 'provider_request_id' AND v_payload->>'provider_request_id' IS NOT NULL THEN v_payload->>'provider_request_id'
      ELSE q.provider_request_id
    END,
    provider_ref = CASE
      WHEN 'provider_ref' = ANY(v_clear_fields) THEN NULL
      WHEN v_payload ? 'provider_ref' AND v_payload->>'provider_ref' IS NOT NULL THEN v_payload->>'provider_ref'
      ELSE q.provider_ref
    END
  WHERE q.id = NEW.queue_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.apply_oci_queue_transition_snapshot() IS
  'Phase 22 snapshot trigger: applies immutable queue transitions onto offline_conversion_queue while preserving Phase 21 guardrails.';

INSERT INTO public.oci_queue_transitions (queue_id, new_status, actor, created_at)
SELECT
  q.id,
  q.status,
  'SYSTEM_BACKFILL',
  COALESCE(q.updated_at, q.created_at, now())
FROM public.offline_conversion_queue AS q
WHERE NOT EXISTS (
  SELECT 1
  FROM public.oci_queue_transitions AS t
  WHERE t.queue_id = q.id
);

DROP TRIGGER IF EXISTS trg_oci_queue_transitions_snapshot ON public.oci_queue_transitions;
CREATE TRIGGER trg_oci_queue_transitions_snapshot
  AFTER INSERT ON public.oci_queue_transitions
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_oci_queue_transition_snapshot();

CREATE OR REPLACE FUNCTION public.claim_offline_conversion_jobs_v2(
  p_site_id uuid,
  p_provider_key text,
  p_limit int DEFAULT 50
)
RETURNS SETOF public.offline_conversion_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int;
  v_claimed_at timestamptz := now();
  v_inserted_queue_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'claim_offline_conversion_jobs_v2 may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));

  WITH candidates AS (
    SELECT oq.id
    FROM public.offline_conversion_queue AS oq
    JOIN public.sites AS s ON s.id = oq.site_id
    WHERE oq.site_id = p_site_id
      AND oq.provider_key = p_provider_key
      AND oq.status IN ('QUEUED', 'RETRY')
      AND (oq.next_retry_at IS NULL OR oq.next_retry_at <= now())
      AND s.oci_sync_method = 'api'
    ORDER BY oq.next_retry_at ASC NULLS FIRST, oq.created_at ASC
    LIMIT v_limit
    FOR UPDATE OF oq SKIP LOCKED
  ),
  inserted AS (
    INSERT INTO public.oci_queue_transitions (queue_id, new_status, error_payload, actor, created_at)
    SELECT
      c.id,
      'PROCESSING',
      jsonb_build_object('claimed_at', v_claimed_at),
      'RPC_CLAIM',
      v_claimed_at
    FROM candidates AS c
    RETURNING queue_id
  )
  SELECT COALESCE(array_agg(queue_id), ARRAY[]::uuid[])
  INTO v_inserted_queue_ids
  FROM inserted;

  RETURN QUERY
  SELECT q.*
  FROM public.offline_conversion_queue AS q
  WHERE q.id = ANY(v_inserted_queue_ids)
  ORDER BY q.created_at ASC
  FOR UPDATE;
END;
$$;

COMMENT ON FUNCTION public.claim_offline_conversion_jobs_v2(uuid, text, int) IS
  'Phase 22 ledger-first claim path. Inserts PROCESSING transitions with actor RPC_CLAIM and returns snapped queue rows.';

GRANT EXECUTE ON FUNCTION public.claim_offline_conversion_jobs_v2(uuid, text, int) TO service_role;

COMMIT;
