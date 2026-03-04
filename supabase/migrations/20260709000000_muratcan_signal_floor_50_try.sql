-- Muratcan: Sinyal (V2/V3/V4) floor'u 1000 TRY -> 50 TRY.
-- Neden: min_conversion_value_cents = 100000 (1000 TRY) hesaplanan değeri (örn. V3 = AOV*0.2*decay = 100-200 TRY)
--        her zaman 1000 TRY'ye çekiyordu. 50 TRY floor ile matematiğe göre değer korunur.

BEGIN;

UPDATE public.sites
SET min_conversion_value_cents = 5000
WHERE id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073';

COMMIT;
