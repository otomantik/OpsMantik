-- DEFCON-1: Replace partial OCI queue status FSM with explicit allow-list matrix
-- (OCI_QUEUE_LIFECYCLE_CONTRACT.md §2–§3 + operator/manual/worker paths).
-- PR-9K operator requeue carve-out preserved (session gate opsmantik.pr9k_operator_requeue).

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_oci_status_fsm()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- PR-9K: session-gated escape from script-terminal success back to active queue.
  IF current_setting('opsmantik.pr9k_operator_requeue', true) = 'on'
     AND OLD.status IN ('COMPLETED', 'UPLOADED')
     AND NEW.status IN ('RETRY', 'QUEUED') THEN
    RETURN NEW;
  END IF;

  IF (
    -- Claim / export / fast-path worker
    (OLD.status = 'QUEUED' AND NEW.status IN ('PROCESSING', 'FAILED'))
    OR (OLD.status = 'RETRY' AND NEW.status IN ('PROCESSING', 'FAILED', 'QUEUED'))
    OR (
      OLD.status = 'PROCESSING'
      AND NEW.status IN (
        'UPLOADED',
        'COMPLETED',
        'COMPLETED_UNVERIFIED',
        'FAILED',
        'RETRY',
        'DEAD_LETTER_QUARANTINE',
        'QUEUED'
      )
    )
    OR (
      OLD.status = 'UPLOADED'
      AND NEW.status IN (
        'COMPLETED',
        'COMPLETED_UNVERIFIED',
        'FAILED',
        'VOIDED_BY_REVERSAL',
        'PROCESSING'
      )
    )
    OR (
      OLD.status = 'FAILED'
      AND NEW.status IN ('RETRY', 'QUEUED', 'DEAD_LETTER_QUARANTINE', 'VOIDED_BY_REVERSAL')
    )
    OR (OLD.status = 'BLOCKED_PRECEDING_SIGNALS' AND NEW.status IN ('QUEUED', 'FAILED'))
    OR (OLD.status = 'COMPLETED' AND NEW.status = 'VOIDED_BY_REVERSAL')
    OR (OLD.status = 'COMPLETED_UNVERIFIED' AND NEW.status = 'VOIDED_BY_REVERSAL')
    OR (OLD.status = 'DEAD_LETTER_QUARANTINE' AND NEW.status = 'VOIDED_BY_REVERSAL')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'DEFCON_1_ILLEGAL_STATE_TRANSITION: Cannot move from % to %',
    OLD.status, NEW.status
    USING ERRCODE = 'P0001';
END;
$$;

COMMENT ON FUNCTION public.enforce_oci_status_fsm() IS
  'DEFCON-1 explicit FSM allow-list for offline_conversion_queue.status; PR-9K pr9k_operator_requeue gate preserved.';

COMMIT;
