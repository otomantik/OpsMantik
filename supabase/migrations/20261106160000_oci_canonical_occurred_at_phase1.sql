BEGIN;

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS sale_occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS sale_source_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS sale_time_confidence text,
  ADD COLUMN IF NOT EXISTS sale_occurred_at_source text,
  ADD COLUMN IF NOT EXISTS sale_entry_reason text;

ALTER TABLE public.marketing_signals
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS recorded_at timestamptz DEFAULT timezone('utc', now()),
  ADD COLUMN IF NOT EXISTS source_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS time_confidence text,
  ADD COLUMN IF NOT EXISTS occurred_at_source text,
  ADD COLUMN IF NOT EXISTS entry_reason text;

ALTER TABLE public.offline_conversion_queue
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS recorded_at timestamptz DEFAULT timezone('utc', now()),
  ADD COLUMN IF NOT EXISTS source_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS time_confidence text,
  ADD COLUMN IF NOT EXISTS occurred_at_source text,
  ADD COLUMN IF NOT EXISTS entry_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_schema = 'public'
      AND table_name = 'calls'
      AND constraint_name = 'calls_sale_time_confidence_check'
  ) THEN
    ALTER TABLE public.calls
      ADD CONSTRAINT calls_sale_time_confidence_check
      CHECK (sale_time_confidence IS NULL OR sale_time_confidence IN ('observed', 'operator_entered', 'inferred', 'legacy_migrated'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_schema = 'public'
      AND table_name = 'calls'
      AND constraint_name = 'calls_sale_occurred_at_source_check'
  ) THEN
    ALTER TABLE public.calls
      ADD CONSTRAINT calls_sale_occurred_at_source_check
      CHECK (sale_occurred_at_source IS NULL OR sale_occurred_at_source IN ('sale', 'fallback_confirmed', 'legacy_migrated'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_schema = 'public'
      AND table_name = 'marketing_signals'
      AND constraint_name = 'marketing_signals_time_confidence_check'
  ) THEN
    ALTER TABLE public.marketing_signals
      ADD CONSTRAINT marketing_signals_time_confidence_check
      CHECK (time_confidence IS NULL OR time_confidence IN ('observed', 'operator_entered', 'inferred', 'legacy_migrated'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_schema = 'public'
      AND table_name = 'marketing_signals'
      AND constraint_name = 'marketing_signals_occurred_at_source_check'
  ) THEN
    ALTER TABLE public.marketing_signals
      ADD CONSTRAINT marketing_signals_occurred_at_source_check
      CHECK (occurred_at_source IS NULL OR occurred_at_source IN ('intent', 'qualified', 'proposal', 'legacy_migrated'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_schema = 'public'
      AND table_name = 'offline_conversion_queue'
      AND constraint_name = 'offline_conversion_queue_time_confidence_check'
  ) THEN
    ALTER TABLE public.offline_conversion_queue
      ADD CONSTRAINT offline_conversion_queue_time_confidence_check
      CHECK (time_confidence IS NULL OR time_confidence IN ('observed', 'operator_entered', 'inferred', 'legacy_migrated'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_schema = 'public'
      AND table_name = 'offline_conversion_queue'
      AND constraint_name = 'offline_conversion_queue_occurred_at_source_check'
  ) THEN
    ALTER TABLE public.offline_conversion_queue
      ADD CONSTRAINT offline_conversion_queue_occurred_at_source_check
      CHECK (occurred_at_source IS NULL OR occurred_at_source IN ('sale', 'fallback_confirmed', 'legacy_migrated'));
  END IF;
END
$$;

UPDATE public.calls
SET
  sale_occurred_at = COALESCE(sale_occurred_at, confirmed_at),
  sale_source_timestamp = COALESCE(sale_source_timestamp, confirmed_at),
  sale_time_confidence = COALESCE(sale_time_confidence, 'legacy_migrated'),
  sale_occurred_at_source = COALESCE(sale_occurred_at_source, CASE WHEN confirmed_at IS NOT NULL THEN 'fallback_confirmed' ELSE 'legacy_migrated' END)
WHERE confirmed_at IS NOT NULL
  AND (sale_occurred_at IS NULL OR sale_time_confidence IS NULL OR sale_occurred_at_source IS NULL);

UPDATE public.marketing_signals
SET
  occurred_at = COALESCE(occurred_at, google_conversion_time, created_at),
  recorded_at = COALESCE(recorded_at, created_at, timezone('utc', now())),
  source_timestamp = COALESCE(source_timestamp, google_conversion_time, created_at),
  time_confidence = COALESCE(time_confidence, 'legacy_migrated'),
  occurred_at_source = COALESCE(
    occurred_at_source,
    CASE signal_type
      WHEN 'INTENT_CAPTURED' THEN 'intent'
      WHEN 'MEETING_BOOKED' THEN 'qualified'
      WHEN 'SEAL_PENDING' THEN 'proposal'
      ELSE 'legacy_migrated'
    END
  )
WHERE occurred_at IS NULL
   OR recorded_at IS NULL
   OR source_timestamp IS NULL
   OR time_confidence IS NULL
   OR occurred_at_source IS NULL;

UPDATE public.offline_conversion_queue AS q
SET
  occurred_at = COALESCE(
    q.occurred_at,
    src.sale_occurred_at,
    src.call_sale_occurred_at,
    q.conversion_time,
    q.created_at
  ),
  recorded_at = COALESCE(q.recorded_at, q.created_at, timezone('utc', now())),
  source_timestamp = COALESCE(
    q.source_timestamp,
    src.sale_occurred_at,
    src.call_sale_source_timestamp,
    q.conversion_time,
    q.created_at
  ),
  time_confidence = COALESCE(q.time_confidence, 'legacy_migrated'),
  occurred_at_source = COALESCE(
    q.occurred_at_source,
    CASE
      WHEN src.sale_id IS NOT NULL THEN 'sale'
      WHEN src.call_sale_occurred_at IS NOT NULL THEN 'fallback_confirmed'
      ELSE 'legacy_migrated'
    END
  )
FROM (
  SELECT
    q2.id AS queue_id,
    q2.sale_id,
    s.occurred_at AS sale_occurred_at,
    c.sale_occurred_at AS call_sale_occurred_at,
    c.sale_source_timestamp AS call_sale_source_timestamp
  FROM public.offline_conversion_queue q2
  JOIN public.calls c ON c.id = q2.call_id
  LEFT JOIN public.sales s ON s.id = q2.sale_id
) AS src
WHERE q.id = src.queue_id
  AND (
    q.occurred_at IS NULL
    OR q.recorded_at IS NULL
    OR q.source_timestamp IS NULL
    OR q.time_confidence IS NULL
    OR q.occurred_at_source IS NULL
  );

UPDATE public.offline_conversion_queue
SET
  occurred_at = COALESCE(occurred_at, conversion_time, created_at),
  recorded_at = COALESCE(recorded_at, created_at, timezone('utc', now())),
  source_timestamp = COALESCE(source_timestamp, conversion_time, created_at),
  time_confidence = COALESCE(time_confidence, 'legacy_migrated'),
  occurred_at_source = COALESCE(occurred_at_source, 'legacy_migrated')
WHERE occurred_at IS NULL
   OR recorded_at IS NULL
   OR source_timestamp IS NULL
   OR time_confidence IS NULL
   OR occurred_at_source IS NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_signals_site_occurred_at
  ON public.marketing_signals (site_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_offline_conversion_queue_site_occurred_at
  ON public.offline_conversion_queue (site_id, occurred_at DESC);

COMMENT ON COLUMN public.calls.sale_occurred_at IS
  'Canonical business-event time for V5 sale export. Prefer over confirmed_at when present.';
COMMENT ON COLUMN public.calls.sale_source_timestamp IS
  'Raw operator-provided or inherited V5 timestamp before export-time canonical selection.';
COMMENT ON COLUMN public.calls.sale_time_confidence IS
  'Sale timestamp provenance: observed, operator_entered, inferred, legacy_migrated.';
COMMENT ON COLUMN public.calls.sale_occurred_at_source IS
  'Source of V5 business-event time: sale, fallback_confirmed, legacy_migrated.';
COMMENT ON COLUMN public.calls.sale_entry_reason IS
  'Optional operator reason when sale time is entered late or backdated.';

COMMENT ON COLUMN public.marketing_signals.occurred_at IS
  'Canonical business-event time for signal export. Prefer over google_conversion_time.';
COMMENT ON COLUMN public.marketing_signals.recorded_at IS
  'Physical row-write time for audit. Never export this to Google Ads.';
COMMENT ON COLUMN public.marketing_signals.source_timestamp IS
  'Raw upstream timestamp used to derive occurred_at.';
COMMENT ON COLUMN public.marketing_signals.time_confidence IS
  'Signal timestamp provenance: observed, operator_entered, inferred, legacy_migrated.';
COMMENT ON COLUMN public.marketing_signals.occurred_at_source IS
  'Source of signal business-event time: intent, qualified, proposal, legacy_migrated.';
COMMENT ON COLUMN public.marketing_signals.entry_reason IS
  'Optional human-entered reason for delayed or corrected business-event time.';

COMMENT ON COLUMN public.offline_conversion_queue.occurred_at IS
  'Canonical business-event time for V5 export. Prefer over conversion_time.';
COMMENT ON COLUMN public.offline_conversion_queue.recorded_at IS
  'Physical queue row-write time for audit. Never export this to Google Ads.';
COMMENT ON COLUMN public.offline_conversion_queue.source_timestamp IS
  'Raw upstream timestamp used to derive occurred_at.';
COMMENT ON COLUMN public.offline_conversion_queue.time_confidence IS
  'Queue timestamp provenance: observed, operator_entered, inferred, legacy_migrated.';
COMMENT ON COLUMN public.offline_conversion_queue.occurred_at_source IS
  'Source of queue business-event time: sale, fallback_confirmed, legacy_migrated.';
COMMENT ON COLUMN public.offline_conversion_queue.entry_reason IS
  'Optional human-entered reason for delayed or corrected business-event time.';

COMMIT;
