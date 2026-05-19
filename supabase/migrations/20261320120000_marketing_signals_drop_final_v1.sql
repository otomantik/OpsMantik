-- Final retirement: drop marketing_signals table, triggers, and retention/dispatch RPCs.
-- Queue-only OCI: offline_conversion_queue is the sole conversion journal.
-- Idempotent: safe when marketing_signals was already dropped on remote.

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

DROP FUNCTION IF EXISTS public.enforce_marketing_signal_time_from_call_created_at();

CREATE OR REPLACE FUNCTION public.validate_conversion_value_policy_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_sqlstate text := 'P0001';
BEGIN
  IF TG_TABLE_NAME = 'offline_conversion_queue' THEN
    IF NEW.action = 'OpsMantik_Won' THEN
      IF NEW.value_cents IS NULL OR NEW.value_cents <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = v_sqlstate, MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:won_value_cents_required_positive';
      END IF;
      IF NEW.value_cents < 6000 OR NEW.value_cents > 12000 THEN
        RAISE EXCEPTION USING ERRCODE = v_sqlstate, MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:won_value_cents_out_of_range_6000_12000';
      END IF;
      IF COALESCE(NEW.value_policy_version, '') = '' THEN
        RAISE EXCEPTION USING ERRCODE = v_sqlstate, MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:queue_policy_version_required';
      END IF;
      IF COALESCE(NEW.value_source, '') = '' THEN
        RAISE EXCEPTION USING ERRCODE = v_sqlstate, MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:queue_value_source_required';
      END IF;
      IF NEW.actual_revenue IS NOT NULL AND NEW.actual_revenue > 0 THEN
        IF COALESCE(NEW.value_fallback_used, false) = true THEN
          RAISE EXCEPTION USING ERRCODE = v_sqlstate, MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:won_actual_revenue_present_fallback_must_be_false';
        END IF;
      ELSIF COALESCE(NEW.value_fallback_used, false) = false THEN
        RAISE EXCEPTION USING ERRCODE = v_sqlstate, MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:won_actual_revenue_missing_fallback_must_be_true';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.validate_conversion_value_policy_v1()
IS 'PR-D guardrails: validates conversion value policy v1 for offline_conversion_queue writes only.';

DROP FUNCTION IF EXISTS public.cleanup_marketing_signals_batch(integer, integer);
DROP FUNCTION IF EXISTS public.cleanup_marketing_signals_batch(integer, integer, boolean);
DROP FUNCTION IF EXISTS public.apply_marketing_signal_dispatch_batch_v1(uuid, uuid[], text, text, timestamptz);
DROP FUNCTION IF EXISTS public.rescue_marketing_signals_stale_processing_v1(timestamptz);
DROP FUNCTION IF EXISTS public.recover_stuck_marketing_signals(integer);
DROP FUNCTION IF EXISTS public.get_marketing_signals_as_of(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.marketing_signals_bitemporal_audit();

ALTER TABLE IF EXISTS public.parity_audit_log DROP CONSTRAINT IF EXISTS parity_audit_log_signal_id_fkey;
ALTER TABLE IF EXISTS public.parity_violation_dlq DROP CONSTRAINT IF EXISTS parity_violation_dlq_signal_id_fkey;

DROP VIEW IF EXISTS public.pipeline_health_watchtower;
DROP TABLE IF EXISTS public.marketing_signals_history;
DROP TABLE IF EXISTS public.marketing_signals;

COMMIT;
