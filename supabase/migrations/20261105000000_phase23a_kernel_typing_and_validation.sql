BEGIN;

-- ============================================================================
-- Phase 23A: additive kernel typing, warning-mode payload validation, and
-- claim-index preparation. No claim-order or write-path behavior changes yet.
-- ============================================================================

ALTER TABLE public.offline_conversion_queue
  ADD COLUMN IF NOT EXISTS brain_score smallint,
  ADD COLUMN IF NOT EXISTS match_score smallint,
  ADD COLUMN IF NOT EXISTS queue_priority smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_version smallint,
  ADD COLUMN IF NOT EXISTS score_flags integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_explain_jsonb jsonb;

COMMENT ON COLUMN public.offline_conversion_queue.brain_score IS
  'Phase 23A typed routing score snapshot. Nullable until score-on-insert cutover.';
COMMENT ON COLUMN public.offline_conversion_queue.match_score IS
  'Phase 23A immutable match-quality snapshot copied from ingest/match pipeline when available.';
COMMENT ON COLUMN public.offline_conversion_queue.queue_priority IS
  'Phase 23A hot-path claim priority. Claim ORDER BY cutover happens in Phase 23C.';
COMMENT ON COLUMN public.offline_conversion_queue.score_version IS
  'Phase 23A typed score schema version.';
COMMENT ON COLUMN public.offline_conversion_queue.score_flags IS
  'Phase 23A bit flags for score/routing decisions.';
COMMENT ON COLUMN public.offline_conversion_queue.score_explain_jsonb IS
  'Phase 23A cold explainability payload kept out of the hot claim path.';

ALTER TABLE public.oci_queue_transitions
  ADD COLUMN IF NOT EXISTS brain_score smallint,
  ADD COLUMN IF NOT EXISTS match_score smallint,
  ADD COLUMN IF NOT EXISTS queue_priority smallint,
  ADD COLUMN IF NOT EXISTS score_version smallint,
  ADD COLUMN IF NOT EXISTS score_flags integer,
  ADD COLUMN IF NOT EXISTS score_explain_jsonb jsonb;

COMMENT ON COLUMN public.oci_queue_transitions.brain_score IS
  'Phase 23A typed routing score written on transition append when available.';
COMMENT ON COLUMN public.oci_queue_transitions.match_score IS
  'Phase 23A immutable match-quality score on the transition.';
COMMENT ON COLUMN public.oci_queue_transitions.queue_priority IS
  'Phase 23A typed priority value intended for future claim-order cutover.';
COMMENT ON COLUMN public.oci_queue_transitions.score_version IS
  'Phase 23A typed score schema version on the transition.';
COMMENT ON COLUMN public.oci_queue_transitions.score_flags IS
  'Phase 23A bit flags for score/routing decisions on the transition.';
COMMENT ON COLUMN public.oci_queue_transitions.score_explain_jsonb IS
  'Phase 23A cold explainability JSON kept out of the snapshot hot path.';

CREATE TABLE IF NOT EXISTS public.oci_payload_validation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  queue_id uuid,
  site_id uuid,
  attempted_status text NOT NULL,
  unknown_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_required jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb,
  note text,
  CONSTRAINT oci_payload_validation_events_unknown_keys_array CHECK (
    jsonb_typeof(unknown_keys) = 'array'
  ),
  CONSTRAINT oci_payload_validation_events_missing_required_array CHECK (
    jsonb_typeof(missing_required) = 'array'
  ),
  CONSTRAINT oci_payload_validation_events_actor_check CHECK (
    actor IN ('SCRIPT', 'WORKER', 'RPC_CLAIM', 'SWEEPER', 'MANUAL', 'SYSTEM_BACKFILL')
  ),
  CONSTRAINT oci_payload_validation_events_status_check CHECK (
    attempted_status IN (
      'QUEUED',
      'RETRY',
      'PROCESSING',
      'UPLOADED',
      'COMPLETED',
      'COMPLETED_UNVERIFIED',
      'FAILED',
      'DEAD_LETTER_QUARANTINE'
    )
  )
);

COMMENT ON TABLE public.oci_payload_validation_events IS
  'Phase 23A warning-mode telemetry for transition payload drift before strict validation is enforced.';

CREATE INDEX IF NOT EXISTS idx_oci_payload_validation_events_created_at
  ON public.oci_payload_validation_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oci_payload_validation_events_site_queue
  ON public.oci_payload_validation_events (site_id, queue_id, created_at DESC);

ALTER TABLE public.oci_payload_validation_events DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.oci_payload_validation_events TO service_role;

CREATE OR REPLACE FUNCTION public.oci_transition_payload_allowed_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
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

COMMENT ON FUNCTION public.oci_transition_payload_allowed_keys() IS
  'Phase 23A canonical allowlist for oci_queue_transitions.error_payload keys.';

CREATE OR REPLACE FUNCTION public.oci_transition_payload_unknown_keys(p_payload jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN ARRAY[]::text[]
      ELSE COALESCE((
        SELECT array_agg(entry.key ORDER BY entry.key)
        FROM jsonb_each(p_payload) AS entry
        WHERE entry.key <> ALL(public.oci_transition_payload_allowed_keys())
      ), ARRAY[]::text[])
    END;
$$;

COMMENT ON FUNCTION public.oci_transition_payload_unknown_keys(jsonb) IS
  'Phase 23A warning-mode helper that returns unknown top-level payload keys.';

CREATE OR REPLACE FUNCTION public.oci_transition_payload_missing_required(
  p_status text,
  p_payload jsonb
)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
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

COMMENT ON FUNCTION public.oci_transition_payload_missing_required(text, jsonb) IS
  'Phase 23A warning-mode helper that reports status-specific missing required keys.';

CREATE OR REPLACE FUNCTION public.log_oci_payload_validation_event(
  p_actor text,
  p_queue_id uuid,
  p_site_id uuid,
  p_attempted_status text,
  p_payload jsonb,
  p_unknown_keys text[] DEFAULT ARRAY[]::text[],
  p_missing_required text[] DEFAULT ARRAY[]::text[],
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
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

COMMENT ON FUNCTION public.log_oci_payload_validation_event(text, uuid, uuid, text, jsonb, text[], text[], text) IS
  'Phase 23A warning-mode telemetry writer for transition payload drift.';

CREATE INDEX IF NOT EXISTS idx_offline_conversion_queue_priority_claim_phase23
  ON public.offline_conversion_queue (
    site_id,
    provider_key,
    queue_priority DESC,
    next_retry_at ASC NULLS FIRST,
    created_at ASC,
    id ASC
  )
  WHERE status IN ('QUEUED', 'RETRY');

COMMENT ON INDEX public.idx_offline_conversion_queue_priority_claim_phase23 IS
  'Phase 23A additive claim index. Existing pending indexes remain until Phase 23C cutover.';

COMMIT;
