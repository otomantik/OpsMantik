-- Idempotent purge: retired audit table and RPCs must not exist after queue-only cut.
-- Safe when marketing_signals was already dropped before this migration runs.

BEGIN;

DO $drop_retired_audit_triggers$
BEGIN
  IF to_regclass('public.marketing_signals') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_enforce_marketing_signal_time_from_call_created_at ON public.marketing_signals;
    DROP TRIGGER IF EXISTS trg_validate_conversion_value_policy_v1_signals ON public.marketing_signals;
    DROP TRIGGER IF EXISTS trg_marketing_signals_bitemporal ON public.marketing_signals;
  END IF;
END
$drop_retired_audit_triggers$;

DROP FUNCTION IF EXISTS public.cleanup_marketing_signals_batch(integer, integer);
DROP FUNCTION IF EXISTS public.cleanup_marketing_signals_batch(integer, integer, boolean);
DROP FUNCTION IF EXISTS public.apply_marketing_signal_dispatch_batch_v1(uuid, uuid[], text, text, timestamptz);
DROP FUNCTION IF EXISTS public.rescue_marketing_signals_stale_processing_v1(timestamptz);
DROP FUNCTION IF EXISTS public.recover_stuck_marketing_signals(integer);
DROP FUNCTION IF EXISTS public.enforce_marketing_signal_time_from_call_created_at();
DROP FUNCTION IF EXISTS public.get_marketing_signals_as_of(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.marketing_signals_bitemporal_audit();

DROP VIEW IF EXISTS public.pipeline_health_watchtower;
DROP TABLE IF EXISTS public.marketing_signals_history;
DROP TABLE IF EXISTS public.marketing_signals;

COMMIT;
