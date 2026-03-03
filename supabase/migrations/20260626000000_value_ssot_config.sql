-- PR-VK-1: Value SSOT Config — min_conversion_value_cents, proposal key, qualified fix
-- Safe read path handles missing keys; migration for clean state.

BEGIN;

-- 1. min_conversion_value_cents
ALTER TABLE public.sites
ADD COLUMN IF NOT EXISTS min_conversion_value_cents bigint DEFAULT 100000;

COMMENT ON COLUMN public.sites.min_conversion_value_cents IS
'Minimum conversion value in minor units (cents); used as floor. Default 100000 = 1000 TRY.';

-- 2. proposal key (optional; read path fallback covers absence)
UPDATE public.sites
SET intent_weights = jsonb_set(
    COALESCE(intent_weights, '{"pending": 0.02, "qualified": 0.20, "sealed": 1.0}'::jsonb),
    '{proposal}',
    '0.30'::jsonb
)
WHERE intent_weights->>'proposal' IS NULL;

-- 3. qualified 0.10 → 0.20 (optional)
UPDATE public.sites
SET intent_weights = jsonb_set(intent_weights, '{qualified}', '0.20'::jsonb)
WHERE (intent_weights->>'qualified')::numeric = 0.10;

COMMIT;
