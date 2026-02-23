-- Test ortamı: Tüm siteleri PRO tier + Türkçe (TRY, tr-TR, Europe/Istanbul).
-- Akşam testleri için tek seferlik veya staging ortamında kullanılır.
-- Çalıştırma: supabase db push veya Supabase SQL Editor'da bu dosyanın içeriğini çalıştır.

BEGIN;

-- -----------------------------------------------------------------------------
-- 0) Audit trigger fix: site_plans has no "id", only site_id (PK). Avoid v_row.id.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_table_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_id uuid;
  v_rid text;
  v_sid uuid;
  v_row record;
BEGIN
  v_actor_id := auth.uid();
  v_row := COALESCE(NEW, OLD);
  IF TG_TABLE_NAME = 'site_plans' THEN
    v_rid := v_row.site_id::text;
    v_sid := v_row.site_id;
  ELSE
    v_rid := COALESCE(v_row.id::text, v_row.site_id::text);
    v_sid := v_row.site_id;
  END IF;

  INSERT INTO public.audit_log (actor_type, actor_id, action, resource_type, resource_id, site_id, payload)
  VALUES (
    CASE WHEN v_actor_id IS NOT NULL THEN 'user' ELSE 'service_role' END,
    v_actor_id,
    TG_OP,
    TG_TABLE_NAME,
    v_rid,
    v_sid,
    jsonb_build_object('table_name', TG_TABLE_NAME, 'record_id', v_rid, 'operation', TG_OP)
  );
  RETURN v_row;
END; $$;

-- -----------------------------------------------------------------------------
-- 1) Tüm siteler: para birimi TRY, dil tr-TR, saat dilimi Europe/Istanbul
-- -----------------------------------------------------------------------------
UPDATE public.sites
SET
  currency = 'TRY',
  timezone = 'Europe/Istanbul',
  locale = 'tr-TR'
WHERE currency != 'TRY' OR timezone != 'Europe/Istanbul' OR locale != 'tr-TR';

-- -----------------------------------------------------------------------------
-- 2) Entitlements (Sprint-1): Her site için ACTIVE PRO abonelik
-- -----------------------------------------------------------------------------
-- Mevcut ACTIVE abonelikleri PRO yap
UPDATE public.subscriptions
SET tier = 'PRO', updated_at = now()
WHERE status = 'ACTIVE' AND (tier IS NULL OR tier != 'PRO');

-- Aboneliği olmayan sitelere PRO ACTIVE ekle
INSERT INTO public.subscriptions (site_id, tier, status, provider, created_at, updated_at)
SELECT s.id, 'PRO', 'ACTIVE', 'MANUAL', now(), now()
FROM public.sites s
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscriptions sub
  WHERE sub.site_id = s.id AND sub.status = 'ACTIVE'
);

-- -----------------------------------------------------------------------------
-- 3) Quota (site_plans): Tüm siteler PRO limit (25_000, soft limit açık)
-- -----------------------------------------------------------------------------
UPDATE public.site_plans
SET
  plan_tier = 'pro',
  monthly_limit = 25000,
  soft_limit_enabled = true,
  updated_at = now();

-- site_plans satırı olmayan sitelere PRO plan ekle (idempotent)
INSERT INTO public.site_plans (site_id, plan_tier, monthly_limit, soft_limit_enabled, hard_cap_multiplier, created_at, updated_at)
SELECT s.id, 'pro', 25000, true, 2, now(), now()
FROM public.sites s
WHERE NOT EXISTS (SELECT 1 FROM public.site_plans sp WHERE sp.site_id = s.id)
ON CONFLICT (site_id) DO UPDATE SET
  plan_tier = 'pro',
  monthly_limit = 25000,
  soft_limit_enabled = true,
  updated_at = excluded.updated_at;

COMMIT;
