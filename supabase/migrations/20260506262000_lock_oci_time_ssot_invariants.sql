BEGIN;

ALTER TABLE public.marketing_signals
  DROP CONSTRAINT IF EXISTS marketing_signals_time_ssot_check;

ALTER TABLE public.marketing_signals
  ADD CONSTRAINT marketing_signals_time_ssot_check
  CHECK (
    call_id IS NULL
    OR (
      occurred_at IS NOT NULL
      AND google_conversion_time IS NOT NULL
      AND google_conversion_time = occurred_at
    )
  );

ALTER TABLE public.offline_conversion_queue
  DROP CONSTRAINT IF EXISTS offline_conversion_queue_time_ssot_check;

ALTER TABLE public.offline_conversion_queue
  ADD CONSTRAINT offline_conversion_queue_time_ssot_check
  CHECK (
    call_id IS NULL
    OR (
      occurred_at IS NOT NULL
      AND conversion_time IS NOT NULL
      AND source_timestamp IS NOT NULL
      AND conversion_time = occurred_at
      AND source_timestamp = occurred_at
    )
  );

COMMIT;
