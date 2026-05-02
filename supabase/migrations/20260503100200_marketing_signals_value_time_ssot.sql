-- SSOT economics + audit columns on marketing_signals; deterministic value_cents mirror.
-- See lib/oci/marketing-signal-value-ssot.ts + upsertMarketingSignal.

BEGIN;

ALTER TABLE public.marketing_signals
  ADD COLUMN IF NOT EXISTS currency_code text,
  ADD COLUMN IF NOT EXISTS value_source text,
  ADD COLUMN IF NOT EXISTS conversion_time_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'marketing_signals'
      AND column_name = 'value_cents'
  ) THEN
    ALTER TABLE public.marketing_signals
      ADD COLUMN value_cents bigint
      GENERATED ALWAYS AS (COALESCE(expected_value_cents, 0::bigint)) STORED;
  END IF;
END $$;

COMMENT ON COLUMN public.marketing_signals.currency_code IS 'ISO 4217 minor-unit currency (site currency at insert).';
COMMENT ON COLUMN public.marketing_signals.value_source IS 'Provenance for export value: stage_model, fixed_junk_exclusion, etc.';
COMMENT ON COLUMN public.marketing_signals.conversion_time_source IS 'How conversion time was chosen (e.g. ledger_stage_event).';
COMMENT ON COLUMN public.marketing_signals.value_cents IS 'Stored mirror of expected_value_cents for exports/UI (junk nominal = 10).';

-- Inserts must set google_conversion_time from ledger/stage time (upsertMarketingSignal does).
ALTER TABLE public.marketing_signals
  ALTER COLUMN google_conversion_time DROP DEFAULT;

COMMIT;
