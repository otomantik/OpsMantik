-- Phase 23B/23C: immutable oci_queue_transitions ledger, snapshot apply, and claim/append RPCs.
-- Recovers remote drift where these objects were missing (script export 409 / RPC not found).

BEGIN;

CREATE TABLE IF NOT EXISTS public.oci_payload_validation_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  actor text NOT NULL,
  queue_id uuid,
  site_id uuid,
  attempted_status text NOT NULL,
  unknown_keys jsonb DEFAULT '[]'::jsonb NOT NULL,
  missing_required jsonb DEFAULT '[]'::jsonb NOT NULL,
  payload jsonb,
  note text,
  CONSTRAINT oci_payload_validation_events_actor_check CHECK (
    actor = ANY (ARRAY['SCRIPT', 'WORKER', 'RPC_CLAIM', 'SWEEPER', 'MANUAL', 'SYSTEM_BACKFILL']::text[])
  ),
  CONSTRAINT oci_payload_validation_events_missing_required_array CHECK (jsonb_typeof(missing_required) = 'array'),
  CONSTRAINT oci_payload_validation_events_status_check CHECK (
    attempted_status = ANY (
      ARRAY[
        'QUEUED',
        'RETRY',
        'PROCESSING',
        'UPLOADED',
        'COMPLETED',
        'COMPLETED_UNVERIFIED',
        'FAILED',
        'DEAD_LETTER_QUARANTINE'
      ]::text[]
    )
  ),
  CONSTRAINT oci_payload_validation_events_unknown_keys_array CHECK (jsonb_typeof(unknown_keys) = 'array')
);

CREATE TABLE IF NOT EXISTS public.oci_queue_transitions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  queue_id uuid NOT NULL,
  new_status text NOT NULL,
  error_payload jsonb,
  actor text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  brain_score smallint,
  match_score smallint,
  queue_priority smallint,
  score_version smallint,
  score_flags integer,
  score_explain_jsonb jsonb,
  CONSTRAINT oci_queue_transitions_actor_check CHECK (
    actor = ANY (ARRAY['SCRIPT', 'WORKER', 'RPC_CLAIM', 'SWEEPER', 'MANUAL', 'SYSTEM_BACKFILL']::text[])
  ),
  CONSTRAINT oci_queue_transitions_new_status_check CHECK (
    new_status = ANY (
      ARRAY[
        'QUEUED',
        'RETRY',
        'PROCESSING',
        'UPLOADED',
        'COMPLETED',
        'COMPLETED_UNVERIFIED',
        'FAILED',
        'DEAD_LETTER_QUARANTINE',
        'VOIDED_BY_REVERSAL'
      ]::text[]
    )
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND r.relname = 'oci_payload_validation_events'
      AND c.conname = 'oci_payload_validation_events_pkey'
  ) THEN
    ALTER TABLE ONLY public.oci_payload_validation_events
      ADD CONSTRAINT oci_payload_validation_events_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND r.relname = 'oci_queue_transitions'
      AND c.conname = 'oci_queue_transitions_pkey'
  ) THEN
    ALTER TABLE ONLY public.oci_queue_transitions
      ADD CONSTRAINT oci_queue_transitions_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'oci_queue_transitions_queue_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.oci_queue_transitions
      ADD CONSTRAINT oci_queue_transitions_queue_id_fkey
      FOREIGN KEY (queue_id) REFERENCES public.offline_conversion_queue (id) ON DELETE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_oci_queue_transitions_created_at ON public.oci_queue_transitions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oci_queue_transitions_queue_created_at ON public.oci_queue_transitions (queue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oci_queue_transitions_queue_id_desc ON public.oci_queue_transitions (queue_id, id DESC);

CREATE OR REPLACE FUNCTION public.oci_transition_payload_allowed_keys() RETURNS text[]
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO public
  AS $$
  SELECT ARRAY[
    'last_error',
    'provider_error_code',
    'provider_error_category',
    'attempt_count',
    'retry_count',
    'next_retry_at',
    'uploaded_at',
    'claimed_at',
    'provider_request_id',
    'provider_ref',
    'clear_fields'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION public.oci_transition_payload_missing_required(p_status text, p_payload jsonb) RETURNS text[]
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO public
  AS $$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
BEGIN
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RETURN ARRAY['payload_object'];
  END IF;

  IF p_status = 'PROCESSING' THEN
    IF NOT (v_payload ? 'claimed_at') THEN
      v_missing := array_append(v_missing, 'claimed_at');
    END IF;
  ELSIF p_status = 'RETRY' THEN
    IF NOT (v_payload ? 'next_retry_at') THEN
      v_missing := array_append(v_missing, 'next_retry_at');
    END IF;
    IF NOT (v_payload ? 'provider_error_category') THEN
      v_missing := array_append(v_missing, 'provider_error_category');
    END IF;
  ELSIF p_status IN ('FAILED', 'DEAD_LETTER_QUARANTINE') THEN
    IF NOT (v_payload ? 'provider_error_category') THEN
      v_missing := array_append(v_missing, 'provider_error_category');
    END IF;
  END IF;

  RETURN v_missing;
END;
$$;

CREATE OR REPLACE FUNCTION public.oci_transition_payload_unknown_keys(p_payload jsonb) RETURNS text[]
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO public
  AS $$
  SELECT
    CASE
      WHEN p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN ARRAY[]::text[]
      ELSE COALESCE((
        SELECT array_agg(entry.key ORDER BY entry.key)
        FROM jsonb_each(p_payload) AS entry
        WHERE entry.key <> ALL (public.oci_transition_payload_allowed_keys())
      ), ARRAY[]::text[])
    END;
$$;

CREATE OR REPLACE FUNCTION public.queue_transition_clear_fields(p_payload jsonb) RETURNS text[]
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO public
  AS $$
  SELECT
    CASE
      WHEN p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN ARRAY[]::text[]
      WHEN p_payload ? 'clear_fields' AND jsonb_typeof(p_payload->'clear_fields') = 'array' THEN
        COALESCE(
          ARRAY(
            SELECT jsonb_array_elements_text(p_payload->'clear_fields')
          ),
          ARRAY[]::text[]
        )
      ELSE ARRAY[]::text[]
    END;
$$;

CREATE OR REPLACE FUNCTION public.queue_transition_payload_has_meaningful_patch(p_payload jsonb) RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO public
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
          ) AS clear_field (elem)
          WHERE clear_field.elem IN (
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

CREATE OR REPLACE FUNCTION public.log_oci_payload_validation_event(
  p_actor text,
  p_queue_id uuid,
  p_site_id uuid,
  p_attempted_status text,
  p_payload jsonb,
  p_unknown_keys text[] DEFAULT ARRAY[]::text[],
  p_missing_required text[] DEFAULT ARRAY[]::text[],
  p_note text DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql
  SET search_path TO public
  AS $$
BEGIN
  IF COALESCE(array_length(p_unknown_keys, 1), 0) = 0
     AND COALESCE(array_length(p_missing_required, 1), 0) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.oci_payload_validation_events (
    actor,
    queue_id,
    site_id,
    attempted_status,
    unknown_keys,
    missing_required,
    payload,
    note
  )
  VALUES (
    p_actor,
    p_queue_id,
    p_site_id,
    p_attempted_status,
    to_jsonb(COALESCE(p_unknown_keys, ARRAY[]::text[])),
    to_jsonb(COALESCE(p_missing_required, ARRAY[]::text[])),
    p_payload,
    p_note
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_snapshot_batch(p_queue_ids uuid[]) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO public
  AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_invalid_transition_id uuid;
  v_invalid_queue_id uuid;
  v_invalid_clear_field text;
  v_noop_transition_id uuid;
  v_noop_queue_id uuid;
  v_updated integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'apply_snapshot_batch may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM 1
  FROM public.offline_conversion_queue AS q
  WHERE q.id = ANY (v_queue_ids)
  ORDER BY q.id
  FOR UPDATE;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      t.new_status,
      t.error_payload,
      t.actor,
      t.created_at,
      t.brain_score,
      t.match_score,
      t.queue_priority,
      t.score_version,
      t.score_flags,
      t.score_explain_jsonb
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY (v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  )
  SELECT l.id, l.queue_id
  INTO v_invalid_transition_id, v_invalid_queue_id
  FROM latest AS l
  WHERE l.error_payload IS NOT NULL
    AND jsonb_typeof(l.error_payload) <> 'object'
  LIMIT 1;

  IF v_invalid_transition_id IS NOT NULL THEN
    RAISE EXCEPTION 'oci_queue_transitions.error_payload must be a JSON object or null for transition % queue %', v_invalid_transition_id, v_invalid_queue_id;
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      t.error_payload
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY (v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  )
  SELECT l.id, l.queue_id
  INTO v_invalid_transition_id, v_invalid_queue_id
  FROM latest AS l
  WHERE l.error_payload ? 'clear_fields'
    AND jsonb_typeof(l.error_payload->'clear_fields') <> 'array'
  LIMIT 1;

  IF v_invalid_transition_id IS NOT NULL
     AND v_invalid_queue_id IS NOT NULL THEN
    RAISE EXCEPTION 'oci_queue_transitions.error_payload.clear_fields must be an array for transition % queue %', v_invalid_transition_id, v_invalid_queue_id;
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      public.queue_transition_clear_fields(t.error_payload) AS clear_fields
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY (v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  )
  SELECT l.id, l.queue_id, field_name
  INTO v_invalid_transition_id, v_invalid_queue_id, v_invalid_clear_field
  FROM latest AS l
  CROSS JOIN LATERAL unnest(l.clear_fields) AS field_name
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

  IF v_invalid_transition_id IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported clear_fields value in oci_queue_transitions.error_payload for transition % queue %: %',
      v_invalid_transition_id, v_invalid_queue_id, v_invalid_clear_field;
  END IF;

  PERFORM public.log_oci_payload_validation_event(
    latest.actor,
    latest.queue_id,
    q.site_id,
    latest.new_status,
    latest.error_payload,
    public.oci_transition_payload_unknown_keys(latest.error_payload),
    public.oci_transition_payload_missing_required(latest.new_status, latest.error_payload),
    'phase23b_warning_mode'
  )
  FROM (
    SELECT DISTINCT ON (t.queue_id)
      t.queue_id,
      t.actor,
      t.new_status,
      t.error_payload,
      t.created_at,
      t.id
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY (v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  ) AS latest
  JOIN public.offline_conversion_queue AS q
    ON q.id = latest.queue_id
  WHERE COALESCE(array_length(public.oci_transition_payload_unknown_keys(latest.error_payload), 1), 0) > 0
     OR COALESCE(array_length(public.oci_transition_payload_missing_required(latest.new_status, latest.error_payload), 1), 0) > 0;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      t.new_status,
      t.error_payload
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY (v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  )
  SELECT l.id, l.queue_id
  INTO v_noop_transition_id, v_noop_queue_id
  FROM latest AS l
  JOIN public.offline_conversion_queue AS q
    ON q.id = l.queue_id
  WHERE l.new_status = q.status
    AND NOT public.queue_transition_payload_has_meaningful_patch(l.error_payload)
  LIMIT 1;

  IF v_noop_transition_id IS NOT NULL THEN
    RAISE EXCEPTION 'NOOP_TRANSITION: transition % queue % already in status %',
      v_noop_transition_id, v_noop_queue_id,
      (SELECT q2.status FROM public.offline_conversion_queue AS q2 WHERE q2.id = v_noop_queue_id);
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      t.new_status,
      t.error_payload,
      t.created_at,
      t.brain_score,
      t.match_score,
      t.queue_priority,
      t.score_version,
      t.score_flags,
      t.score_explain_jsonb
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY (v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  ),
  prepared AS (
    SELECT
      l.*,
      public.queue_transition_clear_fields(l.error_payload) AS clear_fields
    FROM latest AS l
  )
  UPDATE public.offline_conversion_queue AS q
  SET
    status = p.new_status,
    updated_at = p.created_at,
    last_error = CASE
      WHEN 'last_error' = ANY (p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'last_error' AND p.error_payload->>'last_error' IS NOT NULL THEN p.error_payload->>'last_error'
      ELSE q.last_error
    END,
    provider_error_code = CASE
      WHEN 'provider_error_code' = ANY (p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'provider_error_code' AND p.error_payload->>'provider_error_code' IS NOT NULL THEN p.error_payload->>'provider_error_code'
      ELSE q.provider_error_code
    END,
    provider_error_category = CASE
      WHEN 'provider_error_category' = ANY (p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'provider_error_category' AND p.error_payload->>'provider_error_category' IS NOT NULL THEN p.error_payload->>'provider_error_category'
      ELSE q.provider_error_category
    END,
    attempt_count = CASE
      WHEN p.error_payload ? 'attempt_count' AND p.error_payload->>'attempt_count' IS NOT NULL THEN (p.error_payload->>'attempt_count')::int
      ELSE q.attempt_count
    END,
    retry_count = CASE
      WHEN p.error_payload ? 'retry_count' AND p.error_payload->>'retry_count' IS NOT NULL THEN (p.error_payload->>'retry_count')::int
      ELSE q.retry_count
    END,
    next_retry_at = CASE
      WHEN 'next_retry_at' = ANY (p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'next_retry_at' AND p.error_payload->>'next_retry_at' IS NOT NULL THEN (p.error_payload->>'next_retry_at')::timestamptz
      ELSE q.next_retry_at
    END,
    uploaded_at = CASE
      WHEN 'uploaded_at' = ANY (p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'uploaded_at' AND p.error_payload->>'uploaded_at' IS NOT NULL THEN (p.error_payload->>'uploaded_at')::timestamptz
      ELSE q.uploaded_at
    END,
    claimed_at = CASE
      WHEN 'claimed_at' = ANY (p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'claimed_at' AND p.error_payload->>'claimed_at' IS NOT NULL THEN (p.error_payload->>'claimed_at')::timestamptz
      ELSE q.claimed_at
    END,
    provider_request_id = CASE
      WHEN 'provider_request_id' = ANY (p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'provider_request_id' AND p.error_payload->>'provider_request_id' IS NOT NULL THEN p.error_payload->>'provider_request_id'
      ELSE q.provider_request_id
    END,
    provider_ref = CASE
      WHEN 'provider_ref' = ANY (p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'provider_ref' AND p.error_payload->>'provider_ref' IS NOT NULL THEN p.error_payload->>'provider_ref'
      ELSE q.provider_ref
    END,
    brain_score = COALESCE(p.brain_score, q.brain_score),
    match_score = COALESCE(p.match_score, q.match_score),
    queue_priority = COALESCE(p.queue_priority, q.queue_priority),
    score_version = COALESCE(p.score_version, q.score_version),
    score_flags = COALESCE(p.score_flags, q.score_flags),
    score_explain_jsonb = COALESCE(p.score_explain_jsonb, q.score_explain_jsonb)
  FROM prepared AS p
  WHERE q.id = p.queue_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_latest_ledger_matches_snapshot(p_queue_ids uuid[]) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO public
  AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_mismatch record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'assert_latest_ledger_matches_snapshot may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      t.new_status,
      t.error_payload,
      t.created_at,
      t.brain_score,
      t.match_score,
      t.queue_priority,
      t.score_version,
      t.score_flags,
      t.score_explain_jsonb
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY (v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  ),
  prepared AS (
    SELECT
      l.*,
      public.queue_transition_clear_fields(l.error_payload) AS clear_fields
    FROM latest AS l
  ),
  comparison AS (
    SELECT
      q.id AS queue_id,
      p.id AS transition_id,
      CASE
        WHEN q.status IS DISTINCT FROM p.new_status THEN 'status'
        WHEN 'last_error' = ANY (p.clear_fields) AND q.last_error IS NOT NULL THEN 'last_error'
        WHEN p.error_payload ? 'last_error' AND p.error_payload->>'last_error' IS NOT NULL AND q.last_error IS DISTINCT FROM p.error_payload->>'last_error' THEN 'last_error'
        WHEN 'provider_error_code' = ANY (p.clear_fields) AND q.provider_error_code IS NOT NULL THEN 'provider_error_code'
        WHEN p.error_payload ? 'provider_error_code' AND p.error_payload->>'provider_error_code' IS NOT NULL AND q.provider_error_code IS DISTINCT FROM p.error_payload->>'provider_error_code' THEN 'provider_error_code'
        WHEN 'provider_error_category' = ANY (p.clear_fields) AND q.provider_error_category IS NOT NULL THEN 'provider_error_category'
        WHEN p.error_payload ? 'provider_error_category' AND p.error_payload->>'provider_error_category' IS NOT NULL AND q.provider_error_category IS DISTINCT FROM p.error_payload->>'provider_error_category' THEN 'provider_error_category'
        WHEN p.error_payload ? 'attempt_count' AND p.error_payload->>'attempt_count' IS NOT NULL AND q.attempt_count IS DISTINCT FROM (p.error_payload->>'attempt_count')::int THEN 'attempt_count'
        WHEN p.error_payload ? 'retry_count' AND p.error_payload->>'retry_count' IS NOT NULL AND q.retry_count IS DISTINCT FROM (p.error_payload->>'retry_count')::int THEN 'retry_count'
        WHEN 'next_retry_at' = ANY (p.clear_fields) AND q.next_retry_at IS NOT NULL THEN 'next_retry_at'
        WHEN p.error_payload ? 'next_retry_at' AND p.error_payload->>'next_retry_at' IS NOT NULL AND q.next_retry_at IS DISTINCT FROM (p.error_payload->>'next_retry_at')::timestamptz THEN 'next_retry_at'
        WHEN 'uploaded_at' = ANY (p.clear_fields) AND q.uploaded_at IS NOT NULL THEN 'uploaded_at'
        WHEN p.error_payload ? 'uploaded_at' AND p.error_payload->>'uploaded_at' IS NOT NULL AND q.uploaded_at IS DISTINCT FROM (p.error_payload->>'uploaded_at')::timestamptz THEN 'uploaded_at'
        WHEN 'claimed_at' = ANY (p.clear_fields) AND q.claimed_at IS NOT NULL THEN 'claimed_at'
        WHEN p.error_payload ? 'claimed_at' AND p.error_payload->>'claimed_at' IS NOT NULL AND q.claimed_at IS DISTINCT FROM (p.error_payload->>'claimed_at')::timestamptz THEN 'claimed_at'
        WHEN 'provider_request_id' = ANY (p.clear_fields) AND q.provider_request_id IS NOT NULL THEN 'provider_request_id'
        WHEN p.error_payload ? 'provider_request_id' AND p.error_payload->>'provider_request_id' IS NOT NULL AND q.provider_request_id IS DISTINCT FROM p.error_payload->>'provider_request_id' THEN 'provider_request_id'
        WHEN 'provider_ref' = ANY (p.clear_fields) AND q.provider_ref IS NOT NULL THEN 'provider_ref'
        WHEN p.error_payload ? 'provider_ref' AND p.error_payload->>'provider_ref' IS NOT NULL AND q.provider_ref IS DISTINCT FROM p.error_payload->>'provider_ref' THEN 'provider_ref'
        WHEN p.brain_score IS NOT NULL AND q.brain_score IS DISTINCT FROM p.brain_score THEN 'brain_score'
        WHEN p.match_score IS NOT NULL AND q.match_score IS DISTINCT FROM p.match_score THEN 'match_score'
        WHEN p.queue_priority IS NOT NULL AND q.queue_priority IS DISTINCT FROM p.queue_priority THEN 'queue_priority'
        WHEN p.score_version IS NOT NULL AND q.score_version IS DISTINCT FROM p.score_version THEN 'score_version'
        WHEN p.score_flags IS NOT NULL AND q.score_flags IS DISTINCT FROM p.score_flags THEN 'score_flags'
        WHEN p.score_explain_jsonb IS NOT NULL AND q.score_explain_jsonb IS DISTINCT FROM p.score_explain_jsonb THEN 'score_explain_jsonb'
        ELSE NULL
      END AS mismatch_field
    FROM prepared AS p
    JOIN public.offline_conversion_queue AS q
      ON q.id = p.queue_id
  )
  SELECT *
  INTO v_mismatch
  FROM comparison
  WHERE mismatch_field IS NOT NULL
  ORDER BY queue_id
  LIMIT 1;

  IF v_mismatch.queue_id IS NOT NULL THEN
    RAISE EXCEPTION 'SNAPSHOT_ASSERT_FAILED: queue % transition % mismatch on field %',
      v_mismatch.queue_id, v_mismatch.transition_id, v_mismatch.mismatch_field;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_oci_queue_transition_snapshot() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO public
  AS $$
BEGIN
  IF current_setting('opsmantik.skip_snapshot_trigger', true) = 'on' THEN
    RETURN NEW;
  END IF;

  PERFORM public.apply_snapshot_batch(ARRAY[NEW.queue_id]);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.append_rpc_claim_transition_batch(p_queue_ids uuid[], p_claimed_at timestamptz DEFAULT now()) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO public
  AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_rpc_claim_transition_batch may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('opsmantik.skip_snapshot_trigger', 'on', true);

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload,
    brain_score,
    match_score,
    queue_priority,
    score_version,
    score_flags,
    score_explain_jsonb
  )
  SELECT
    q.id,
    'PROCESSING',
    'RPC_CLAIM',
    p_claimed_at,
    jsonb_build_object('claimed_at', p_claimed_at),
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  FROM public.offline_conversion_queue AS q
  JOIN unnest(v_queue_ids) AS input_ids(queue_id)
    ON input_ids.queue_id = q.id
  ORDER BY q.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.apply_snapshot_batch(v_queue_ids);
  PERFORM public.assert_latest_ledger_matches_snapshot(v_queue_ids);

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.append_script_claim_transition_batch(p_queue_ids uuid[], p_claimed_at timestamptz DEFAULT now()) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO public
  AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_script_claim_transition_batch may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('opsmantik.skip_snapshot_trigger', 'on', true);

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload,
    brain_score,
    match_score,
    queue_priority,
    score_version,
    score_flags,
    score_explain_jsonb
  )
  SELECT
    q.id,
    'PROCESSING',
    'SCRIPT',
    p_claimed_at,
    jsonb_build_object(
      'claimed_at', p_claimed_at,
      'attempt_count', q.attempt_count + 1
    ),
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  FROM public.offline_conversion_queue AS q
  JOIN unnest(v_queue_ids) AS input_ids(queue_id)
    ON input_ids.queue_id = q.id
  WHERE q.status IN ('QUEUED', 'RETRY')
  ORDER BY q.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.apply_snapshot_batch(v_queue_ids);
  PERFORM public.assert_latest_ledger_matches_snapshot(v_queue_ids);

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.append_script_transition_batch(
  p_queue_ids uuid[],
  p_new_status text,
  p_created_at timestamptz DEFAULT now(),
  p_error_payload jsonb DEFAULT NULL
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO public
  AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_script_transition_batch may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  IF p_new_status NOT IN ('RETRY', 'FAILED', 'DEAD_LETTER_QUARANTINE', 'COMPLETED', 'COMPLETED_UNVERIFIED', 'PROCESSING', 'QUEUED', 'UPLOADED', 'VOIDED_BY_REVERSAL') THEN
    RAISE EXCEPTION 'invalid_status: %', p_new_status;
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('opsmantik.skip_snapshot_trigger', 'on', true);

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload,
    brain_score,
    match_score,
    queue_priority,
    score_version,
    score_flags,
    score_explain_jsonb
  )
  SELECT
    q.id,
    p_new_status,
    'SCRIPT',
    p_created_at,
    p_error_payload,
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  FROM public.offline_conversion_queue AS q
  JOIN unnest(v_queue_ids) AS input_ids(queue_id)
    ON input_ids.queue_id = q.id
  ORDER BY q.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.apply_snapshot_batch(v_queue_ids);
  PERFORM public.assert_latest_ledger_matches_snapshot(v_queue_ids);

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_offline_conversion_rows_for_script_export(p_ids uuid[], p_site_id uuid) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO public
  AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'claim_offline_conversion_rows_for_script_export may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(q.id ORDER BY q.id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM public.offline_conversion_queue AS q
  WHERE q.id = ANY (COALESCE(p_ids, ARRAY[]::uuid[]))
    AND q.site_id = p_site_id
    AND q.status IN ('QUEUED', 'RETRY');

  RETURN public.append_script_claim_transition_batch(v_queue_ids, now());
END;
$$;

DROP TRIGGER IF EXISTS trg_oci_queue_transitions_snapshot ON public.oci_queue_transitions;

CREATE TRIGGER trg_oci_queue_transitions_snapshot
AFTER INSERT ON public.oci_queue_transitions
FOR EACH ROW
EXECUTE FUNCTION public.apply_oci_queue_transition_snapshot();

ALTER TABLE public.oci_payload_validation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oci_queue_transitions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.oci_payload_validation_events OWNER TO postgres;
ALTER TABLE public.oci_queue_transitions OWNER TO postgres;

ALTER FUNCTION public.oci_transition_payload_allowed_keys() OWNER TO postgres;
ALTER FUNCTION public.oci_transition_payload_missing_required(text, jsonb) OWNER TO postgres;
ALTER FUNCTION public.oci_transition_payload_unknown_keys(jsonb) OWNER TO postgres;
ALTER FUNCTION public.queue_transition_clear_fields(jsonb) OWNER TO postgres;
ALTER FUNCTION public.queue_transition_payload_has_meaningful_patch(jsonb) OWNER TO postgres;
ALTER FUNCTION public.log_oci_payload_validation_event(text, uuid, uuid, text, jsonb, text[], text[], text) OWNER TO postgres;
ALTER FUNCTION public.apply_snapshot_batch(uuid[]) OWNER TO postgres;
ALTER FUNCTION public.assert_latest_ledger_matches_snapshot(uuid[]) OWNER TO postgres;
ALTER FUNCTION public.apply_oci_queue_transition_snapshot() OWNER TO postgres;
ALTER FUNCTION public.append_rpc_claim_transition_batch(uuid[], timestamptz) OWNER TO postgres;
ALTER FUNCTION public.append_script_claim_transition_batch(uuid[], timestamptz) OWNER TO postgres;
ALTER FUNCTION public.append_script_transition_batch(uuid[], text, timestamptz, jsonb) OWNER TO postgres;
ALTER FUNCTION public.claim_offline_conversion_rows_for_script_export(uuid[], uuid) OWNER TO postgres;

GRANT ALL ON TABLE public.oci_payload_validation_events TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.oci_queue_transitions TO anon, authenticated, service_role;

GRANT ALL ON FUNCTION public.oci_transition_payload_allowed_keys() TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.oci_transition_payload_missing_required(text, jsonb) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.oci_transition_payload_unknown_keys(jsonb) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.queue_transition_clear_fields(jsonb) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.queue_transition_payload_has_meaningful_patch(jsonb) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.log_oci_payload_validation_event(text, uuid, uuid, text, jsonb, text[], text[], text) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.apply_snapshot_batch(uuid[]) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.assert_latest_ledger_matches_snapshot(uuid[]) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.apply_oci_queue_transition_snapshot() TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.append_rpc_claim_transition_batch(uuid[], timestamptz) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.append_script_claim_transition_batch(uuid[], timestamptz) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.append_script_transition_batch(uuid[], text, timestamptz, jsonb) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.claim_offline_conversion_rows_for_script_export(uuid[], uuid) TO anon, authenticated, service_role;

COMMIT;
