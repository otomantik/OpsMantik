-- PR-VK-7: Minor-Units SSOT — expected_value_cents (BIGINT)
-- Internal SSOT in cents; conversion_value (NUMERIC) kept for Google Ads / backward compat.

BEGIN;

-- 1. Yeni kolon (kuruş hassasiyeti, integer)
ALTER TABLE public.marketing_signals
ADD COLUMN IF NOT EXISTS expected_value_cents bigint;

COMMENT ON COLUMN public.marketing_signals.expected_value_cents IS
'Conversion value in minor units (cents). SSOT for internal math; conversion_value = expected_value_cents/100 for export.';

-- 2. Backfill: mevcut conversion_value (major) → expected_value_cents
UPDATE public.marketing_signals
SET expected_value_cents = (conversion_value * 100)::bigint
WHERE expected_value_cents IS NULL AND conversion_value IS NOT NULL;

-- 3. İndeks (BI / değer bazlı filtreleme)
CREATE INDEX IF NOT EXISTS idx_marketing_signals_expected_value_cents
ON public.marketing_signals (expected_value_cents);

COMMIT;
