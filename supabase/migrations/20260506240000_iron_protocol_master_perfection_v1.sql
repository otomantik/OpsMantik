-- 💎 Iron Protocol: Master Perfection (Sovereign DB)
-- Created: 2026-05-06
-- Scope: Automation, Integrity, Observability, Discipline

BEGIN;

--------------------------------------------------------------------------------
-- 1. AUTOMATION: Trigger-based updated_at
--------------------------------------------------------------------------------

-- Common trigger function to maintain updated_at across all tables
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to critical OCI tables
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.tables 
           WHERE table_schema = 'public' 
           AND table_name IN ('outbox_events', 'marketing_signals', 'offline_conversion_queue', 'calls', 'sessions')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_updated_at ON public.%I', t);
    EXECUTE format('CREATE TRIGGER tr_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
  END LOOP;
END $$;


--------------------------------------------------------------------------------
-- 2. INTEGRITY: FSM (Finite State Machine) Guard
--------------------------------------------------------------------------------

-- This function prevents illegal state transitions in the OCI queue.
-- Example: A 'COMPLETED' or 'VOIDED' record cannot go back to 'QUEUED' without a formal reset.
CREATE OR REPLACE FUNCTION public.enforce_oci_status_fsm()
RETURNS TRIGGER AS $$
BEGIN
  -- Prevent modification of terminal states unless explicitly allowed
  IF (OLD.status IN ('COMPLETED', 'VOIDED_BY_REVERSAL', 'DEAD_LETTER_QUARANTINE')) 
     AND (NEW.status IN ('QUEUED', 'RETRY')) THEN
    RAISE EXCEPTION 'FSM_VIOLATION: Illegal transition from terminal state % to % for queue_id %', OLD.status, NEW.status, NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_oci_status_fsm ON public.offline_conversion_queue;
CREATE TRIGGER tr_oci_status_fsm 
BEFORE UPDATE OF status ON public.offline_conversion_queue 
FOR EACH ROW EXECUTE FUNCTION public.enforce_oci_status_fsm();


--------------------------------------------------------------------------------
-- 3. OBSERVABILITY: The Watchtower View
--------------------------------------------------------------------------------

-- A high-level engineering view to see pipeline health at a glance.
CREATE OR REPLACE VIEW public.pipeline_health_watchtower AS
SELECT
  'OCI_OUTBOX' as component,
  status,
  count(*) as count,
  round(extract(epoch from (now() - min(created_at))) / 60) as max_age_minutes,
  avg(attempt_count)::numeric(10,2) as avg_attempts
FROM public.outbox_events
GROUP BY status
UNION ALL
SELECT
  'OCI_QUEUE' as component,
  status,
  count(*) as count,
  round(extract(epoch from (now() - min(created_at))) / 60) as max_age_minutes,
  avg(attempt_count)::numeric(10,2) as avg_attempts
FROM public.offline_conversion_queue
GROUP BY status
UNION ALL
SELECT
  'MARKETING_SIGNALS' as component,
  dispatch_status as status,
  count(*) as count,
  round(extract(epoch from (now() - min(created_at))) / 60) as max_age_minutes,
  0 as avg_attempts
FROM public.marketing_signals
GROUP BY dispatch_status;

GRANT SELECT ON public.pipeline_health_watchtower TO authenticated;


--------------------------------------------------------------------------------
-- 4. DISCIPLINE: Constraint Hardening
--------------------------------------------------------------------------------

-- Ensure sale_amount is never negative
ALTER TABLE public.calls ADD CONSTRAINT calls_sale_amount_positive CHECK (sale_amount IS NULL OR sale_amount >= 0);

-- Ensure next_retry_at is always in the future for RETRY status
ALTER TABLE public.offline_conversion_queue ADD CONSTRAINT oci_queue_retry_future CHECK (
  status != 'RETRY' OR (next_retry_at IS NOT NULL AND next_retry_at > created_at)
);

COMMIT;
