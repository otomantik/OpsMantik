-- Tüm siteler script sync: API (worker) yok, export script ile çalışacak.
-- list_offline_conversion_groups sadece oci_sync_method='api' döner; script export
-- sadece 'script' (veya api olmayan) siteleri kabul eder. Hepsi script olunca
-- script export tüm siteler için çalışır.

BEGIN;

UPDATE public.sites
SET oci_sync_method = 'script'
WHERE oci_sync_method = 'api';

COMMIT;
