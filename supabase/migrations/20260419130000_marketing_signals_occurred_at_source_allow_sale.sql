-- 20260419130000_marketing_signals_occurred_at_source_allow_sale.sql
--
-- Expand marketing_signals.occurred_at_source CHECK constraint to allow 'sale'.
--
-- Background:
--   Migration 20261106160000 introduced
--     CHECK (occurred_at_source IN ('intent', 'qualified', 'proposal', 'legacy_migrated'))
--   on marketing_signals. At the time, the seal path ('sale') wrote exclusively to
--   offline_conversion_queue and never to marketing_signals, so 'sale' was excluded
--   from the CHECK on purpose.
--
--   The upsertMarketingSignal SSOT helper introduced in Phase 2 now supports a
--   `source: 'seal'` write path, and the lib/oci/occurred-at.ts resolver maps
--   stage='satis' → occurred_at_source='sale'. To let the seal path (or any future
--   satis-aware gear) write adjustment-bearing rows into marketing_signals without
--   tripping the CHECK, we extend the allowed set to include 'sale'.
--
--   Code-level gates (stage-router.ts / insert-marketing-signal.ts) that previously
--   short-circuited 'satis' only because of this CHECK can now be relaxed; the
--   architectural rule "seal owns the sale dispatch queue" stays enforced by
--   insert-marketing-signal.ts's junk/satis early-return (belt-and-suspenders).
--
-- Safety:
--   - Existing rows already satisfy the new CHECK because the old allowed set is
--     a strict subset of the new one. Postgres will accept the ALTER without
--     rescanning (or the rescan will succeed trivially).
--   - The migration is idempotent: it drops the old constraint by name before
--     re-adding the expanded one.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'marketing_signals'
      AND constraint_name = 'marketing_signals_occurred_at_source_check'
  ) THEN
    ALTER TABLE public.marketing_signals
      DROP CONSTRAINT marketing_signals_occurred_at_source_check;
  END IF;
END;
$$;

ALTER TABLE public.marketing_signals
  ADD CONSTRAINT marketing_signals_occurred_at_source_check
  CHECK (
    occurred_at_source IS NULL
    OR occurred_at_source IN ('intent', 'qualified', 'proposal', 'sale', 'legacy_migrated')
  );

COMMENT ON COLUMN public.marketing_signals.occurred_at_source IS
  'Occurred-at provenance tag. Allowed: intent | qualified | proposal | sale | legacy_migrated. '
  '''sale'' was added in 20260419130000 to support seal-path adjustments written via upsertMarketingSignal.';

COMMIT;
