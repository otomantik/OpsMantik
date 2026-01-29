-- =============================================================================
-- TACTICAL FALLBACK: PRIVATE SCHEMA (Namespace Isolation)
-- Native 'vault' yerine güvenli bir private şema kullanıyoruz.
-- Anahtarlar private.api_keys tablosunda; sadece DB owner (trigger SECURITY DEFINER) okuyabilir.
-- =============================================================================

-- 1. Gizli şema (dış dünyaya kapalı)
CREATE SCHEMA IF NOT EXISTS private;

-- 2. Anahtar tablosu
CREATE TABLE IF NOT EXISTS private.api_keys (
  key_name text PRIMARY KEY,
  key_value text NOT NULL
);

COMMENT ON TABLE private.api_keys IS 'Edge Function / webhook URL ve service_role_key. Sadece SECURITY DEFINER fonksiyonlar okur.';

-- 3. Güvenlik: public, anon, authenticated bu tabloyu göremesin
REVOKE ALL ON SCHEMA private FROM public, anon, authenticated;
REVOKE ALL ON TABLE private.api_keys FROM public, anon, authenticated;

-- 4. Anahtarları BURAYA KOYMA — SQL Editor'da manuel çalıştır:
--    INSERT INTO private.api_keys (key_name, key_value)
--    VALUES
--      ('project_url', 'https://SENIN-PROJE-REF.supabase.co'),
--      ('service_role_key', 'eyJ...SERVICE_ROLE_KEY...')
--    ON CONFLICT (key_name) DO UPDATE SET key_value = EXCLUDED.key_value;
