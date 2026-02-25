-- Sprint-1 Titanium Core: conversion_sends rename + google_ads_sync capability.
-- Platform naming: multi-channel OS. oci_uploads -> conversion_sends, oci_upload -> google_ads_sync.
-- Patch migration: runs after 20260302000000_sprint1_subscriptions_usage_entitlements.sql
-- No UI/i18n changes. Preserve rate-limit vs quota header semantics.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) ALTER usage_counters: oci_uploads_count -> conversion_sends_count
-- -----------------------------------------------------------------------------
ALTER TABLE public.usage_counters
  RENAME COLUMN oci_uploads_count TO conversion_sends_count;

-- -----------------------------------------------------------------------------
-- 2) subscriptions.status: add TRIALING, safe constraint drop
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.subscriptions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE 'ALTER TABLE public.subscriptions DROP CONSTRAINT ' || quote_ident(c.conname);
  END LOOP;
END
$$;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('ACTIVE','TRIALING','CANCELED','PAST_DUE'));

-- -----------------------------------------------------------------------------
-- 3) RLS: service_role INSERT/UPDATE policy (enterprise hardening)
-- -----------------------------------------------------------------------------
CREATE POLICY "subscriptions_insert_update_service_role"
  ON public.subscriptions FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "subscriptions_update_service_role"
  ON public.subscriptions FOR UPDATE
  USING ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "usage_counters_insert_update_service_role"
  ON public.usage_counters FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "usage_counters_update_service_role"
  ON public.usage_counters FOR UPDATE
  USING ((auth.jwt() ->> 'role') = 'service_role');

-- -----------------------------------------------------------------------------
-- 4) _entitlements_no_access: oci_upload -> google_ads_sync, monthly_oci_uploads -> monthly_conversion_sends
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._entitlements_no_access()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'tier', 'FREE',
    'capabilities', jsonb_build_object(
      'dashboard_live_queue', false,
      'dashboard_traffic_widget', false,
      'csv_export', false,
      'google_ads_sync', false,
      'full_attribution_history', false,
      'ai_cro_insights', false,
      'superadmin_god_mode', false,
      'agency_portfolio', false
    ),
    'limits', jsonb_build_object(
      'visible_queue_items', 0,
      'history_days', 0,
      'monthly_revenue_events', 0,
      'monthly_conversion_sends', 0
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- 5) _entitlements_for_tier: oci_upload -> google_ads_sync, monthly_oci_uploads -> monthly_conversion_sends
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._entitlements_for_tier(p_tier text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  RETURN CASE p_tier
    WHEN 'FREE' THEN jsonb_build_object(
      'tier', 'FREE',
      'capabilities', jsonb_build_object(
        'dashboard_live_queue', true,
        'dashboard_traffic_widget', true,
        'csv_export', false,
        'google_ads_sync', false,
        'full_attribution_history', false,
        'ai_cro_insights', false,
        'superadmin_god_mode', false,
        'agency_portfolio', false
      ),
      'limits', jsonb_build_object(
        'visible_queue_items', 10,
        'history_days', 7,
        'monthly_revenue_events', 100,
        'monthly_conversion_sends', 0
      )
    )
    WHEN 'STARTER' THEN jsonb_build_object(
      'tier', 'STARTER',
      'capabilities', jsonb_build_object(
        'dashboard_live_queue', true,
        'dashboard_traffic_widget', true,
        'csv_export', true,
        'google_ads_sync', false,
        'full_attribution_history', false,
        'ai_cro_insights', false,
        'superadmin_god_mode', false,
        'agency_portfolio', false
      ),
      'limits', jsonb_build_object(
        'visible_queue_items', 1000,
        'history_days', 30,
        'monthly_revenue_events', 5000,
        'monthly_conversion_sends', 0
      )
    )
    WHEN 'PRO' THEN jsonb_build_object(
      'tier', 'PRO',
      'capabilities', jsonb_build_object(
        'dashboard_live_queue', true,
        'dashboard_traffic_widget', true,
        'csv_export', true,
        'google_ads_sync', true,
        'full_attribution_history', true,
        'ai_cro_insights', true,
        'superadmin_god_mode', false,
        'agency_portfolio', false
      ),
      'limits', jsonb_build_object(
        'visible_queue_items', 1000000,
        'history_days', 3650,
        'monthly_revenue_events', 25000,
        'monthly_conversion_sends', 25000
      )
    )
    WHEN 'AGENCY' THEN jsonb_build_object(
      'tier', 'AGENCY',
      'capabilities', jsonb_build_object(
        'dashboard_live_queue', true,
        'dashboard_traffic_widget', true,
        'csv_export', true,
        'google_ads_sync', true,
        'full_attribution_history', true,
        'ai_cro_insights', true,
        'superadmin_god_mode', false,
        'agency_portfolio', true
      ),
      'limits', jsonb_build_object(
        'visible_queue_items', 1000000,
        'history_days', 3650,
        'monthly_revenue_events', 100000,
        'monthly_conversion_sends', 100000
      )
    )
    WHEN 'SUPER_ADMIN' THEN jsonb_build_object(
      'tier', 'SUPER_ADMIN',
      'capabilities', jsonb_build_object(
        'dashboard_live_queue', true,
        'dashboard_traffic_widget', true,
        'csv_export', true,
        'google_ads_sync', true,
        'full_attribution_history', true,
        'ai_cro_insights', true,
        'superadmin_god_mode', true,
        'agency_portfolio', true
      ),
      'limits', jsonb_build_object(
        'visible_queue_items', -1,
        'history_days', -1,
        'monthly_revenue_events', -1,
        'monthly_conversion_sends', -1
      )
    )
    ELSE public._entitlements_no_access()
  END;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6) get_entitlements_for_site: status IN (ACTIVE,TRIALING), current_period_end check
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_entitlements_for_site(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean;
  v_uid uuid;
  v_tier text;
BEGIN
  v_uid := auth.uid();
  v_is_service := (v_uid IS NULL AND public._jwt_role() = 'service_role');

  IF NOT v_is_service THEN
    IF NOT public.can_access_site(v_uid, p_site_id) THEN
      RETURN public._entitlements_no_access();
    END IF;
  END IF;

  SELECT s.tier INTO v_tier
  FROM public.subscriptions s
  WHERE s.site_id = p_site_id
    AND s.status IN ('ACTIVE','TRIALING')
    AND (s.current_period_end IS NULL OR s.current_period_end >= now())
  ORDER BY s.current_period_end DESC NULLS LAST
  LIMIT 1;

  IF v_tier IS NULL THEN
    v_tier := 'FREE';
  END IF;

  IF v_uid IS NOT NULL AND public.is_admin(v_uid) THEN
    v_tier := 'SUPER_ADMIN';
  END IF;

  RETURN public._entitlements_for_tier(v_tier);
END;
$$;

-- -----------------------------------------------------------------------------
-- 7) increment_usage_checked: conversion_sends, p_month normalize, INVALID_KIND
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_usage_checked(
  p_site_id uuid,
  p_month date,
  p_kind text,
  p_limit int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean;
  v_month date;
  v_row public.usage_counters%ROWTYPE;
  v_current int;
  v_new int;
BEGIN
  v_is_service := (auth.uid() IS NULL AND public._jwt_role() = 'service_role');
  IF NOT v_is_service THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'FORBIDDEN');
  END IF;

  IF p_kind NOT IN ('revenue_events', 'conversion_sends') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_KIND');
  END IF;

  v_month := date_trunc('month', p_month)::date;

  INSERT INTO public.usage_counters(site_id, month)
  VALUES (p_site_id, v_month)
  ON CONFLICT (site_id, month) DO NOTHING;

  SELECT * INTO v_row
  FROM public.usage_counters
  WHERE site_id = p_site_id AND month = v_month
  FOR UPDATE;

  IF p_kind = 'revenue_events' THEN
    v_current := v_row.revenue_events_count;
  ELSE
    v_current := v_row.conversion_sends_count;
  END IF;

  IF p_limit >= 0 AND (v_current + 1) > p_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LIMIT');
  END IF;

  v_new := v_current + 1;

  IF p_kind = 'revenue_events' THEN
    UPDATE public.usage_counters
    SET revenue_events_count = v_new, updated_at = now()
    WHERE id = v_row.id;
  ELSE
    UPDATE public.usage_counters
    SET conversion_sends_count = v_new, updated_at = now()
    WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'new_count', v_new);
END;
$$;

COMMIT;
