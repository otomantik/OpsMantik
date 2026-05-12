-- PR-9J.3: harden OCI queue status finite-state machine.
--
-- Terminal success/quarantine states must not be downgraded by a late snapshot
-- or manual repair path. FAILED may only move to RETRY, DEAD_LETTER_QUARANTINE,
-- or VOIDED_BY_REVERSAL.

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

  IF OLD.status IN (
    'COMPLETED',
    'UPLOADED',
    'COMPLETED_UNVERIFIED',
    'DEAD_LETTER_QUARANTINE',
    'VOIDED_BY_REVERSAL'
  ) THEN
    IF NEW.status <> 'VOIDED_BY_REVERSAL' THEN
      RAISE EXCEPTION 'FSM_VIOLATION: Illegal transition from terminal state % to % for queue_id %',
        OLD.status, NEW.status, NEW.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF OLD.status = 'FAILED'
     AND NEW.status NOT IN ('RETRY', 'DEAD_LETTER_QUARANTINE', 'VOIDED_BY_REVERSAL') THEN
    RAISE EXCEPTION 'FSM_VIOLATION: Illegal transition from FAILED to % for queue_id %',
      NEW.status, NEW.id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_oci_status_fsm ON public.offline_conversion_queue;
CREATE TRIGGER tr_oci_status_fsm
BEFORE UPDATE OF status ON public.offline_conversion_queue
FOR EACH ROW EXECUTE FUNCTION public.enforce_oci_status_fsm();

COMMENT ON FUNCTION public.enforce_oci_status_fsm()
  IS 'PR-9J.3 hard OCI status FSM guard: terminal statuses cannot downgrade; FAILED can only RETRY, DLQ, or VOID.';

COMMIT;
