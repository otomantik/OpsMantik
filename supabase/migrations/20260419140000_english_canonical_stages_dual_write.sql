-- 20260419140000_english_canonical_stages_dual_write.sql
--
-- Phase 3 (Global Launch, English cutover) — Dual-write CHECK expansion.
--
-- Goal
-- ----
-- OpsMantik canonical pipeline stages are being renamed from Turkish-only
-- literals to English equivalents so the product works identically for
-- non-TR customers:
--
--   gorusuldu → contacted
--   teklif    → offered
--   satis     → won
--   junk      → (unchanged; same in both locales)
--
-- This migration is the *expansion* step. Every stage-bearing CHECK constraint
-- in the public schema is widened so that *both* the old Turkish literal and
-- the new English literal are accepted simultaneously. Application code can
-- then be cut over file-by-file (the "code cutover" todo) while the database
-- tolerates mixed reads/writes.
--
-- Downstream steps (NOT in this migration):
--   1. Code cutover: tests, routes, types, scripts, docs switch to English.
--   2. Backfill migration: UPDATE existing rows gorusuldu→contacted etc.
--   3. Cleanup migration (≥14 days later): remove Turkish values from CHECK.
--
-- Tables touched
-- --------------
--   - marketing_signals.signal_type
--   - marketing_signals.optimization_stage
--   - calls.optimization_stage
--   - offline_conversion_queue.optimization_stage
--   - call_funnel_ledger.event_type
--   - call_funnel_projection.highest_stage
--   - call_funnel_projection.current_stage
--
-- The `enforce_append_only_signals` trigger on marketing_signals is briefly
-- disabled around the ALTER because some Postgres versions re-validate CHECK
-- constraints against the trigger state and can false-positive. The trigger
-- is re-enabled at the end of its block.
--
-- Idempotency
-- -----------
-- Each constraint is dropped IF EXISTS and re-added with a deterministic name,
-- so this migration can be applied multiple times safely (e.g. if Supabase
-- retries the deployment).

BEGIN;

-------------------------------------------------------------------------------
-- 1. marketing_signals.signal_type + optimization_stage
-------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'enforce_append_only_signals'
      AND tgrelid = 'public.marketing_signals'::regclass
  ) THEN
    EXECUTE 'ALTER TABLE public.marketing_signals DISABLE TRIGGER enforce_append_only_signals';
  END IF;
END $$;

ALTER TABLE public.marketing_signals
  DROP CONSTRAINT IF EXISTS enforce_canonical_signal_type;

ALTER TABLE public.marketing_signals
  ADD CONSTRAINT enforce_canonical_signal_type
  CHECK (
    signal_type IN (
      'junk',
      'gorusuldu', 'contacted',
      'teklif', 'offered',
      'satis', 'won'
    )
  );

ALTER TABLE public.marketing_signals
  DROP CONSTRAINT IF EXISTS marketing_signals_optimization_stage_check;

ALTER TABLE public.marketing_signals
  ADD CONSTRAINT marketing_signals_optimization_stage_check
  CHECK (
    optimization_stage IS NULL OR optimization_stage IN (
      'junk',
      'gorusuldu', 'contacted',
      'teklif', 'offered',
      'satis', 'won'
    )
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'enforce_append_only_signals'
      AND tgrelid = 'public.marketing_signals'::regclass
  ) THEN
    EXECUTE 'ALTER TABLE public.marketing_signals ENABLE TRIGGER enforce_append_only_signals';
  END IF;
END $$;

-------------------------------------------------------------------------------
-- 2. calls.optimization_stage
-------------------------------------------------------------------------------
ALTER TABLE public.calls
  DROP CONSTRAINT IF EXISTS calls_optimization_stage_check;

ALTER TABLE public.calls
  ADD CONSTRAINT calls_optimization_stage_check
  CHECK (
    optimization_stage IS NULL OR optimization_stage IN (
      'junk',
      'gorusuldu', 'contacted',
      'teklif', 'offered',
      'satis', 'won'
    )
  );

-------------------------------------------------------------------------------
-- 3. offline_conversion_queue.optimization_stage
-------------------------------------------------------------------------------
ALTER TABLE public.offline_conversion_queue
  DROP CONSTRAINT IF EXISTS offline_conversion_queue_optimization_stage_check;

ALTER TABLE public.offline_conversion_queue
  ADD CONSTRAINT offline_conversion_queue_optimization_stage_check
  CHECK (
    optimization_stage IS NULL OR optimization_stage IN (
      'junk',
      'gorusuldu', 'contacted',
      'teklif', 'offered',
      'satis', 'won'
    )
  );

-------------------------------------------------------------------------------
-- 4. call_funnel_ledger.event_type
-------------------------------------------------------------------------------
ALTER TABLE public.call_funnel_ledger
  DROP CONSTRAINT IF EXISTS enforce_canonical_event_type;

-- Keep the legacy V-stage placeholders and repair markers; just add English aliases.
ALTER TABLE public.call_funnel_ledger
  ADD CONSTRAINT enforce_canonical_event_type
  CHECK (
    event_type IN (
      'junk',
      'gorusuldu', 'contacted',
      'teklif', 'offered',
      'satis', 'won',
      'V1_PAGEVIEW', 'V2_CONTACT', 'V2_PULSE', 'V2_SYNTHETIC',
      'REPAIR_ATTEMPTED', 'REPAIR_COMPLETED', 'REPAIR_FAILED',
      'SYSTEM_JUNK', 'system_repair'
    )
  );

-------------------------------------------------------------------------------
-- 5. call_funnel_projection.highest_stage + current_stage
-------------------------------------------------------------------------------
ALTER TABLE public.call_funnel_projection
  DROP CONSTRAINT IF EXISTS enforce_canonical_highest_stage;

ALTER TABLE public.call_funnel_projection
  ADD CONSTRAINT enforce_canonical_highest_stage
  CHECK (
    highest_stage IS NULL OR highest_stage IN (
      'junk',
      'gorusuldu', 'contacted',
      'teklif', 'offered',
      'satis', 'won'
    )
  );

ALTER TABLE public.call_funnel_projection
  DROP CONSTRAINT IF EXISTS enforce_canonical_current_stage;

ALTER TABLE public.call_funnel_projection
  ADD CONSTRAINT enforce_canonical_current_stage
  CHECK (
    current_stage IN (
      'junk',
      'gorusuldu', 'contacted',
      'teklif', 'offered',
      'satis', 'won',
      'WAITING_FOR_ATTRIBUTION'
    )
  );

-------------------------------------------------------------------------------
-- 6. Comments (documentation for future maintainers)
-------------------------------------------------------------------------------
COMMENT ON CONSTRAINT enforce_canonical_signal_type ON public.marketing_signals IS
  'Phase 3 dual-write: accepts Turkish (gorusuldu/teklif/satis) + English (contacted/offered/won). '
  'Cleanup migration ≥14 days later will drop the Turkish set.';

COMMENT ON CONSTRAINT enforce_canonical_highest_stage ON public.call_funnel_projection IS
  'Phase 3 dual-write: accepts Turkish (gorusuldu/teklif/satis) + English (contacted/offered/won).';

COMMIT;
