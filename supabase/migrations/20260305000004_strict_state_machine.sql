BEGIN;

-- Phase 21: strict DB-level state machines for OCI queue + marketing signals.
-- Guard: ensure status columns are text/varchar (not enum); migration must be adapted if not.
DO $$
DECLARE t text;
BEGIN
  SELECT data_type INTO t
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'offline_conversion_queue' AND column_name = 'status';
  IF t IS NOT NULL AND t NOT IN ('text', 'character varying') THEN
    RAISE EXCEPTION 'offline_conversion_queue.status is %, expected text/varchar for CHECK-based ontology', t;
  END IF;
END $$;

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'marketing_signals') THEN
    RETURN;
  END IF;
  SELECT data_type INTO t
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'marketing_signals' AND column_name = 'dispatch_status';
  IF t IS NOT NULL AND t NOT IN ('text', 'character varying') THEN
    RAISE EXCEPTION 'marketing_signals.dispatch_status is %, expected text/varchar for CHECK-based ontology', t;
  END IF;
END $$;

-- Legacy cleanup: FATAL is removed from the ontology. Normalize queue first.
UPDATE public.offline_conversion_queue
SET status = 'FAILED',
    provider_error_code = COALESCE(provider_error_code, 'LEGACY_FATAL_NORMALIZED'),
    provider_error_category = COALESCE(provider_error_category, 'PERMANENT'),
    last_error = COALESCE(last_error, 'LEGACY_FATAL_NORMALIZED'),
    updated_at = now()
WHERE status = 'FATAL';

ALTER TABLE public.offline_conversion_queue
  DROP CONSTRAINT IF EXISTS offline_conversion_queue_status_check;

ALTER TABLE public.offline_conversion_queue
  ADD CONSTRAINT offline_conversion_queue_status_check
  CHECK (
    status IN (
      'QUEUED',
      'RETRY',
      'PROCESSING',
      'UPLOADED',
      'COMPLETED',
      'COMPLETED_UNVERIFIED',
      'FAILED',
      'DEAD_LETTER_QUARANTINE'
    )
  );

COMMENT ON CONSTRAINT offline_conversion_queue_status_check ON public.offline_conversion_queue IS
  'Phase 21 strict queue ontology: QUEUED, RETRY, PROCESSING, UPLOADED, COMPLETED, COMPLETED_UNVERIFIED, FAILED, DEAD_LETTER_QUARANTINE.';

-- Normalize unexpected legacy signal statuses before new CHECK (avoids ADD CONSTRAINT failure in prod).
-- Guard: marketing_signals created in 20260329, skip if not exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'marketing_signals') THEN
    RETURN;
  END IF;
  UPDATE public.marketing_signals
  SET dispatch_status = 'FAILED'
  WHERE dispatch_status NOT IN (
    'PENDING',
    'PROCESSING',
    'SENT',
    'FAILED',
    'JUNK_ABORTED',
    'DEAD_LETTER_QUARANTINE',
    'SKIPPED_NO_CLICK_ID',
    'STALLED_FOR_HUMAN_AUDIT'
  );
  ALTER TABLE public.marketing_signals
    DROP CONSTRAINT IF EXISTS marketing_signals_dispatch_status_check;
  ALTER TABLE public.marketing_signals
    ADD CONSTRAINT marketing_signals_dispatch_status_check
    CHECK (
      dispatch_status IN (
        'PENDING',
        'PROCESSING',
        'SENT',
        'FAILED',
        'JUNK_ABORTED',
        'DEAD_LETTER_QUARANTINE',
        'SKIPPED_NO_CLICK_ID',
        'STALLED_FOR_HUMAN_AUDIT'
      )
    );
  COMMENT ON CONSTRAINT marketing_signals_dispatch_status_check ON public.marketing_signals IS
    'Phase 21 strict signal ontology: PENDING, PROCESSING, SENT, FAILED, JUNK_ABORTED, DEAD_LETTER_QUARANTINE, SKIPPED_NO_CLICK_ID, STALLED_FOR_HUMAN_AUDIT.';
END
$$;

CREATE OR REPLACE FUNCTION public.enforce_offline_conversion_queue_state_machine()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (
    (OLD.status = 'QUEUED' AND NEW.status IN ('PROCESSING', 'RETRY'))  -- claim or scheduled backoff
    OR (OLD.status = 'RETRY' AND NEW.status IN ('PROCESSING', 'QUEUED'))  -- process or backoff scheduler back to queue
    OR (
      OLD.status = 'PROCESSING'
      AND NEW.status IN (
        'UPLOADED',
        'COMPLETED',
        'RETRY',
        'FAILED',
        'DEAD_LETTER_QUARANTINE',
        'QUEUED'
      )
    )
    OR (OLD.status = 'UPLOADED' AND NEW.status IN ('COMPLETED', 'COMPLETED_UNVERIFIED'))
    OR (OLD.status = 'FAILED' AND NEW.status = 'RETRY')  -- Recovery: manual retry only; FAILED remains terminal for QUEUED
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal queue transition: % -> %', OLD.status, NEW.status;
END;
$$;

COMMENT ON FUNCTION public.enforce_offline_conversion_queue_state_machine() IS
  'Phase 21 strict queue transition matrix. Rejects illegal status moves before UPDATE.';

DROP TRIGGER IF EXISTS trg_offline_conversion_queue_state_machine ON public.offline_conversion_queue;
CREATE TRIGGER trg_offline_conversion_queue_state_machine
  BEFORE UPDATE ON public.offline_conversion_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_offline_conversion_queue_state_machine();

CREATE OR REPLACE FUNCTION public.enforce_marketing_signals_state_machine()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.dispatch_status IS NOT DISTINCT FROM OLD.dispatch_status THEN
    RETURN NEW;
  END IF;

  IF (
    (
      OLD.dispatch_status = 'PENDING'
      AND NEW.dispatch_status IN (
        'PROCESSING',
        'JUNK_ABORTED',
        'SKIPPED_NO_CLICK_ID',
        'STALLED_FOR_HUMAN_AUDIT'
      )
    )
    OR (
      OLD.dispatch_status = 'PROCESSING'
      AND NEW.dispatch_status IN (
        'SENT',
        'FAILED',
        'DEAD_LETTER_QUARANTINE',
        'JUNK_ABORTED',
        'PENDING'
      )
    )
    OR (OLD.dispatch_status = 'STALLED_FOR_HUMAN_AUDIT' AND NEW.dispatch_status = 'PENDING')  -- Recovery: human release stalled
    OR (OLD.dispatch_status = 'FAILED' AND NEW.dispatch_status = 'PENDING')  -- Recovery: manual retry failed signal
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal signal transition: % -> %', OLD.dispatch_status, NEW.dispatch_status;
END;
$$;

COMMENT ON FUNCTION public.enforce_marketing_signals_state_machine() IS
  'Phase 21 strict signal transition matrix. Preserves PENDING terminalization to SKIPPED_NO_CLICK_ID/STALLED_FOR_HUMAN_AUDIT for existing vacuum flows.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'marketing_signals') THEN
    DROP TRIGGER IF EXISTS trg_marketing_signals_state_machine ON public.marketing_signals;
    CREATE TRIGGER trg_marketing_signals_state_machine
      BEFORE UPDATE ON public.marketing_signals
      FOR EACH ROW
      EXECUTE FUNCTION public.enforce_marketing_signals_state_machine();
  END IF;
END
$$;

COMMIT;
