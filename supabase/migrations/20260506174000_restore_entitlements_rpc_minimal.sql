-- Restore minimal entitlements RPC contract for rollout-readiness and strict checks.
-- This implementation is intentionally additive and compatible with current schema
-- (which may not include subscriptions-tier tables).

CREATE OR REPLACE FUNCTION public._jwt_role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(current_setting('request.jwt.claim.role', true), '');
$$;

CREATE OR REPLACE FUNCTION public._entitlements_no_access()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public._entitlements_for_tier(p_tier text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.get_entitlements_for_site(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
  v_is_service boolean;
  v_has_access boolean;
  v_has_api_key boolean;
  v_tier text;
BEGIN
  v_uid := auth.uid();
  -- Service-key calls can arrive without JWT role claims in some environments.
  v_is_service := (
    v_uid IS NULL
    AND COALESCE(public._jwt_role(), '') IN ('service_role', '')
  );

  IF v_is_service THEN
    v_has_access := true;
  ELSIF v_uid IS NULL THEN
    v_has_access := false;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.site_memberships sm
      WHERE sm.site_id = p_site_id
        AND sm.user_id = v_uid
    )
    INTO v_has_access;
  END IF;

  IF NOT v_has_access THEN
    RETURN public._entitlements_no_access();
  END IF;

  SELECT (s.oci_api_key IS NOT NULL AND btrim(s.oci_api_key) <> '')
  INTO v_has_api_key
  FROM public.sites s
  WHERE s.id = p_site_id;

  IF v_uid IS NOT NULL AND public.is_admin() THEN
    v_tier := 'SUPER_ADMIN';
  ELSIF COALESCE(v_has_api_key, false) THEN
    v_tier := 'PRO';
  ELSE
    v_tier := 'STARTER';
  END IF;

  RETURN public._entitlements_for_tier(v_tier);
END;
$$;

COMMENT ON FUNCTION public.get_entitlements_for_site(uuid)
IS 'Compatibility entitlements RPC: service_role or site member gets tier/capabilities; PRO when OCI API key exists.';

REVOKE ALL ON FUNCTION public.get_entitlements_for_site(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_entitlements_for_site(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_entitlements_for_site(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_entitlements_for_site(uuid) TO service_role;
