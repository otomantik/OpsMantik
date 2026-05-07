-- Queue-only hard retirement: remove legacy marketing_signals surface.
-- This migration is intentionally fail-safe with IF EXISTS guards.

BEGIN;

-- Retire helper RPCs/functions tied to marketing_signals lifecycle.
DROP FUNCTION IF EXISTS public.apply_marketing_signal_dispatch_batch_v1(uuid, uuid[], text, text, timestamptz);
DROP FUNCTION IF EXISTS public.rescue_marketing_signals_stale_processing_v1(timestamptz);
DROP FUNCTION IF EXISTS public.recover_stuck_marketing_signals(integer);
DROP FUNCTION IF EXISTS public.cleanup_marketing_signals_batch(integer, integer);

-- Retire table-level triggers/functions if present.
DROP TRIGGER IF EXISTS trg_validate_conversion_value_policy_v1_signals ON public.marketing_signals;

-- Remove known DB dependencies that still reference marketing_signals.
DROP VIEW IF EXISTS public.pipeline_health_watchtower;
ALTER TABLE IF EXISTS public.parity_audit_log
  DROP CONSTRAINT IF EXISTS parity_audit_log_signal_id_fkey;
ALTER TABLE IF EXISTS public.parity_violation_dlq
  DROP CONSTRAINT IF EXISTS parity_violation_dlq_signal_id_fkey;

-- Drop table last.
DROP TABLE IF EXISTS public.marketing_signals;

COMMIT;
