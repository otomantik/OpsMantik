-- Client tarafı useSiteConfig sadece sites.config (JSONB) içindeki currency'i okuyor.
-- Tüm sitelerde config.currency = 'TRY' yap ki müşteri/hesap ekranında para birimi doğru görünsün.
BEGIN;

UPDATE public.sites
SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{currency}', '"TRY"')
WHERE config->>'currency' IS DISTINCT FROM 'TRY';

COMMIT;
