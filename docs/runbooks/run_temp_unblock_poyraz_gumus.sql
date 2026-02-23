-- Temporary quota unblock: Poyraz Antika + Gümüş Alanlar + Akana Spa (by public_id)
-- Run in Supabase SQL Editor. Uses known public_ids; resolves site_id and upserts site_plans.
-- Policy: monthly_limit=50000, soft_limit_enabled=true, hard_cap_multiplier=2
-- Add more public_ids to the IN list as needed.

-- Site public_ids:
--   Poyraz Antika:    b3e9634575df45c390d99d2623ddcde5
--   Gümüş Alanlar:    6e200950ed2c4681b9836eeda49456dd
--   Akana Spa:        cdd5819076a24ec9a55c45553341775b

INSERT INTO public.site_plans (site_id, plan_tier, monthly_limit, soft_limit_enabled, hard_cap_multiplier)
SELECT s.id, 'temp_unblock', 50000, true, 2
FROM public.sites s
WHERE s.public_id IN (
  'b3e9634575df45c390d99d2623ddcde5',  -- Poyraz Antika
  '6e200950ed2c4681b9836eeda49456dd',  -- Gümüş Alanlar (istanbulgumusalanlar.com.tr)
  'cdd5819076a24ec9a55c45553341775b'   -- Akana Spa
)
ON CONFLICT (site_id) DO UPDATE SET
  plan_tier = EXCLUDED.plan_tier,
  monthly_limit = EXCLUDED.monthly_limit,
  soft_limit_enabled = EXCLUDED.soft_limit_enabled,
  hard_cap_multiplier = EXCLUDED.hard_cap_multiplier,
  updated_at = now();

-- Proof: show updated plans
SELECT s.public_id, s.name, s.domain, sp.plan_tier, sp.monthly_limit, sp.soft_limit_enabled, sp.hard_cap_multiplier, sp.updated_at
FROM public.site_plans sp
JOIN public.sites s ON s.id = sp.site_id
WHERE s.public_id IN ('b3e9634575df45c390d99d2623ddcde5', '6e200950ed2c4681b9836eeda49456dd', 'cdd5819076a24ec9a55c45553341775b')
ORDER BY s.domain;
