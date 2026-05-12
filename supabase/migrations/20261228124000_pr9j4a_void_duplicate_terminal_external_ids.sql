-- PR-9J.4a: void duplicate terminal-success external_id rows before the
-- terminal-success unique index is created.
--
-- Keeps the earliest successful row per (site_id, provider_key, external_id)
-- and moves later terminal-success duplicates to VOIDED_BY_REVERSAL through the
-- canonical transition path so the ledger remains auditable.

BEGIN;

ALTER TABLE public.oci_payload_validation_events
  DROP CONSTRAINT IF EXISTS oci_payload_validation_events_status_check;

ALTER TABLE public.oci_payload_validation_events
  ADD CONSTRAINT oci_payload_validation_events_status_check CHECK (
    attempted_status = ANY (
      ARRAY[
        'QUEUED',
        'RETRY',
        'PROCESSING',
        'UPLOADED',
        'COMPLETED',
        'COMPLETED_UNVERIFIED',
        'FAILED',
        'DEAD_LETTER_QUARANTINE',
        'VOIDED_BY_REVERSAL',
        'BLOCKED_PRECEDING_SIGNALS'
      ]::text[]
    )
  );

SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_duplicate_ids uuid[] := ARRAY[]::uuid[];
  v_voided integer := 0;
BEGIN
  WITH ranked AS (
    SELECT
      q.id,
      row_number() OVER (
        PARTITION BY q.site_id, q.provider_key, q.external_id
        ORDER BY q.uploaded_at NULLS LAST, q.updated_at, q.created_at, q.id
      ) AS rn
    FROM public.offline_conversion_queue AS q
    WHERE q.status IN ('COMPLETED', 'UPLOADED', 'COMPLETED_UNVERIFIED')
  )
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
  INTO v_duplicate_ids
  FROM ranked
  WHERE rn > 1;

  IF COALESCE(array_length(v_duplicate_ids, 1), 0) = 0 THEN
    RAISE NOTICE 'PR-9J.4a: no duplicate terminal-success external_id rows found';
    RETURN;
  END IF;

  SELECT public.append_worker_transition_batch_v2(
    v_duplicate_ids,
    'VOIDED_BY_REVERSAL',
    now(),
    jsonb_build_object(
      'reason', 'DUPLICATE_TERMINAL_SUCCESS_EXTERNAL_ID_SWEEP',
      'actor', 'pr9j4a_void_duplicate_terminal_external_ids',
      'last_error', 'DUPLICATE_TERMINAL_SUCCESS_EXTERNAL_ID_VOIDED',
      'provider_error_category', 'DETERMINISTIC_SKIP'
    )
  )
  INTO v_voided;

  RAISE NOTICE 'PR-9J.4a: voided % duplicate terminal-success external_id rows', COALESCE(v_voided, 0);
END;
$$;

COMMIT;
