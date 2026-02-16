-- Temporary quota unblock: Poyraz Antika + Gümüş Alanlar (by public_id)
-- Run in Supabase SQL Editor. Uses known public_ids; resolves site_id and upserts site_plans.
-- Policy: monthly_limit=50000, soft_limit_enabled=true, hard_cap_multiplier=2

-- Site public_ids (from codebase):
--   Poyraz Antika:    b3e9634575df45c390d99d2623ddcde5
--   Gümüş Alanlar:    6e200950ed2c4681b9836eeda49456dd

INSERT INTO public.site_plans (site_id, plan_tier, monthly_limit, soft_limit_enabled, hard_cap_multiplier)
SELECT s.id, 'temp_unblock', 50000, true, 2
FROM public.sites s
WHERE s.public_id IN (
  'b3e9634575df45c390d99d2623ddcde5',  -- Poyraz Antika
  '6e200950ed2c4681b9836eeda49456dd'   -- Gümüş Alanlar (istanbulgumusalanlar.com.tr)
)
ON CONFLICT (site_id) DO UPDATE SET
  plan_tier = EXCLUDED.plan_tier,
  monthly_limit = EXCLUDED.monthly_limit,
  soft_limit_enabled = EXCLUDED.soft_limit_enabled,
  hard_cap_multiplier = EXCLUDED.hard_cap_multiplier,
  updated_at = now();

-- Proof: show updated plans
SELECT s.public_id, s.domain, sp.plan_tier, sp.monthly_limit, sp.soft_limit_enabled, sp.hard_cap_multiplier, sp.updated_at
FROM public.site_plans sp
JOIN public.sites s ON s.id = sp.site_id
WHERE s.public_id IN ('b3e9634575df45c390d99d2623ddcde5', '6e200950ed2c4681b9836eeda49456dd')
ORDER BY s.domain;
