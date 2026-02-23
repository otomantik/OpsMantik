-- Migration: Give queue:operate to all site members (so seal works on all sites)
--
-- Mühür (seal) requires capability queue:operate. Only owner, admin, operator have it;
-- analyst and billing do not. This one-off upgrades all analyst site_members to operator
-- so seal works for every site member. Idempotent: only touches role = 'analyst'.

UPDATE public.site_members
SET role = 'operator'
WHERE role = 'analyst';
