-- jetsolar.com.tr — Site durumu ve tek site düzeltme (Supabase SQL Editor)

-- 1) Mevcut durum
SELECT
  s.id,
  s.public_id,
  s.name,
  s.domain,
  s.currency,
  s.locale,
  s.timezone,
  s.config->>'currency' AS config_currency,
  sub.tier AS sub_tier,
  sub.status AS sub_status,
  sp.plan_tier,
  sp.monthly_limit
FROM public.sites s
LEFT JOIN public.subscriptions sub ON sub.site_id = s.id AND sub.status = 'ACTIVE'
LEFT JOIN public.site_plans sp ON sp.site_id = s.id
WHERE s.domain ILIKE '%jetsolar%'
   OR s.domain = 'jetsolar.com.tr';

-- 2) Tek site düzeltme (PRO + TRY + config.currency)
-- Önce yukarıdaki sorgudan s.id'yi kontrol et, sonra aşağıyı çalıştır.

/*
UPDATE public.sites
SET
  currency = 'TRY',
  timezone = 'Europe/Istanbul',
  locale = 'tr-TR',
  config = jsonb_set(COALESCE(config, '{}'::jsonb), '{currency}', '"TRY"')
WHERE domain ILIKE '%jetsolar%' OR domain = 'jetsolar.com.tr';

INSERT INTO public.subscriptions (site_id, tier, status, provider, created_at, updated_at)
SELECT s.id, 'PRO', 'ACTIVE', 'MANUAL', now(), now()
FROM public.sites s
WHERE (s.domain ILIKE '%jetsolar%' OR s.domain = 'jetsolar.com.tr')
  AND NOT EXISTS (SELECT 1 FROM public.subscriptions sub WHERE sub.site_id = s.id AND sub.status = 'ACTIVE');

UPDATE public.subscriptions
SET tier = 'PRO', updated_at = now()
WHERE status = 'ACTIVE' AND site_id IN (SELECT id FROM public.sites WHERE domain ILIKE '%jetsolar%' OR domain = 'jetsolar.com.tr');

INSERT INTO public.site_plans (site_id, plan_tier, monthly_limit, soft_limit_enabled, hard_cap_multiplier, created_at, updated_at)
SELECT s.id, 'pro', 25000, true, 2, now(), now()
FROM public.sites s
WHERE (s.domain ILIKE '%jetsolar%' OR s.domain = 'jetsolar.com.tr')
  AND NOT EXISTS (SELECT 1 FROM public.site_plans sp WHERE sp.site_id = s.id)
ON CONFLICT (site_id) DO UPDATE SET plan_tier = 'pro', monthly_limit = 25000, soft_limit_enabled = true, updated_at = now();

UPDATE public.site_plans sp
SET plan_tier = 'pro', monthly_limit = 25000, soft_limit_enabled = true, updated_at = now()
FROM public.sites s
WHERE sp.site_id = s.id AND (s.domain ILIKE '%jetsolar%' OR s.domain = 'jetsolar.com.tr');
*/
