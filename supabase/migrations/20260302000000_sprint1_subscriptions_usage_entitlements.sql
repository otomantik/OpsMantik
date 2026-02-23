-- Sprint-1 Titanium Core: subscriptions + usage_counters + entitlements RPCs.
-- Sprint-1: monthly_revenue_events gate uses billable ingest; V2 will narrow to conversion-only (Revenue Event = confirmed + uploaded).
-- No UI/i18n changes. Preserve rate-limit vs quota header semantics.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Table public.subscriptions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('FREE','STARTER','PRO','AGENCY','SUPER_ADMIN')),
  status text CHECK (status IN ('ACTIVE','CANCELED','PAST_DUE')),
  provider text CHECK (provider IN ('LEMON','IYZICO','MANUAL')),
  provider_customer_id text,
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.subscriptions IS 'Sprint-1: Payment state and explicit tier per site. Tier drives get_entitlements_for_site.';

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_select_site_members"
  ON public.subscriptions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.subscriptions.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid())
             OR public.is_admin(auth.uid()))
    )
  );

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO service_role;

-- -----------------------------------------------------------------------------
-- 2) Table public.usage_counters
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  month date NOT NULL,
  revenue_events_count int NOT NULL DEFAULT 0,
  oci_uploads_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, month)
);

COMMENT ON TABLE public.usage_counters IS 'Sprint-1: Per-site per-month counters for entitlement limit checks. Written only via increment_usage_checked (service_role).';

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_counters_select_site_members"
  ON public.usage_counters FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.usage_counters.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid())
             OR public.is_admin(auth.uid()))
    )
  );

GRANT SELECT ON public.usage_counters TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.usage_counters TO service_role;

-- -----------------------------------------------------------------------------
-- 3) Helper: JWT role (service_role detection with fallback)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._jwt_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_claims text;
BEGIN
  v_role := current_setting('request.jwt.claim.role', true);
  IF v_role IS NOT NULL THEN
    RETURN v_role;
  END IF;
  v_claims := current_setting('request.jwt.claims', true);
  IF v_claims IS NOT NULL AND v_claims <> '' THEN
    RETURN (v_claims::jsonb ->> 'role');
  END IF;
  RETURN NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4) Helper: No-access entitlements (fail-closed)
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
      'oci_upload', false,
      'full_attribution_history', false,
      'ai_cro_insights', false,
      'superadmin_god_mode', false,
      'agency_portfolio', false
    ),
    'limits', jsonb_build_object(
      'visible_queue_items', 0,
      'history_days', 0,
      'monthly_revenue_events', 0,
      'monthly_oci_uploads', 0
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- 5) Helper: Tier -> entitlements jsonb (canonical matrix)
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
        'oci_upload', false,
        'full_attribution_history', false,
        'ai_cro_insights', false,
        'superadmin_god_mode', false,
        'agency_portfolio', false
      ),
      'limits', jsonb_build_object(
        'visible_queue_items', 10,
        'history_days', 7,
        'monthly_revenue_events', 100,
        'monthly_oci_uploads', 0
      )
    )
    WHEN 'STARTER' THEN jsonb_build_object(
      'tier', 'STARTER',
      'capabilities', jsonb_build_object(
        'dashboard_live_queue', true,
        'dashboard_traffic_widget', true,
        'csv_export', true,
        'oci_upload', false,
        'full_attribution_history', false,
        'ai_cro_insights', false,
        'superadmin_god_mode', false,
        'agency_portfolio', false
      ),
      'limits', jsonb_build_object(
        'visible_queue_items', 1000,
        'history_days', 30,
        'monthly_revenue_events', 5000,
        'monthly_oci_uploads', 0
      )
    )
    WHEN 'PRO' THEN jsonb_build_object(
      'tier', 'PRO',
      'capabilities', jsonb_build_object(
        'dashboard_live_queue', true,
        'dashboard_traffic_widget', true,
        'csv_export', true,
        'oci_upload', true,
        'full_attribution_history', true,
        'ai_cro_insights', true,
        'superadmin_god_mode', false,
        'agency_portfolio', false
      ),
      'limits', jsonb_build_object(
        'visible_queue_items', 1000000,
        'history_days', 3650,
        'monthly_revenue_events', 25000,
        'monthly_oci_uploads', 25000
      )
    )
    WHEN 'AGENCY' THEN jsonb_build_object(
      'tier', 'AGENCY',
      'capabilities', jsonb_build_object(
        'dashboard_live_queue', true,
        'dashboard_traffic_widget', true,
        'csv_export', true,
        'oci_upload', true,
        'full_attribution_history', true,
        'ai_cro_insights', true,
        'superadmin_god_mode', false,
        'agency_portfolio', true
      ),
      'limits', jsonb_build_object(
        'visible_queue_items', 1000000,
        'history_days', 3650,
        'monthly_revenue_events', 100000,
        'monthly_oci_uploads', 100000
      )
    )
    WHEN 'SUPER_ADMIN' THEN jsonb_build_object(
      'tier', 'SUPER_ADMIN',
      'capabilities', jsonb_build_object(
        'dashboard_live_queue', true,
        'dashboard_traffic_widget', true,
        'csv_export', true,
        'oci_upload', true,
        'full_attribution_history', true,
        'ai_cro_insights', true,
        'superadmin_god_mode', true,
        'agency_portfolio', true
      ),
      'limits', jsonb_build_object(
        'visible_queue_items', -1,
        'history_days', -1,
        'monthly_revenue_events', -1,
        'monthly_oci_uploads', -1
      )
    )
    ELSE public._entitlements_no_access()
  END;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6) RPC get_entitlements_for_site
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
  WHERE s.site_id = p_site_id AND s.status = 'ACTIVE'
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

COMMENT ON FUNCTION public.get_entitlements_for_site(uuid) IS 'Sprint-1: Returns tier + capabilities + limits. No-access or service_role bypass. Optional is_admin -> SUPER_ADMIN.';

GRANT EXECUTE ON FUNCTION public.get_entitlements_for_site(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_entitlements_for_site(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- 7) RPC increment_usage_checked (race-free check + increment)
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
  v_row public.usage_counters%ROWTYPE;
  v_current int;
  v_new int;
BEGIN
  v_is_service := (auth.uid() IS NULL AND public._jwt_role() = 'service_role');
  IF NOT v_is_service THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'FORBIDDEN');
  END IF;

  IF p_kind NOT IN ('revenue_events', 'oci_uploads') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BAD_KIND');
  END IF;

  INSERT INTO public.usage_counters(site_id, month)
  VALUES (p_site_id, p_month)
  ON CONFLICT (site_id, month) DO NOTHING;

  SELECT * INTO v_row
  FROM public.usage_counters
  WHERE site_id = p_site_id AND month = p_month
  FOR UPDATE;

  IF p_kind = 'revenue_events' THEN
    v_current := v_row.revenue_events_count;
  ELSE
    v_current := v_row.oci_uploads_count;
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
    SET oci_uploads_count = v_new, updated_at = now()
    WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'new_count', v_new);
END;
$$;

COMMENT ON FUNCTION public.increment_usage_checked(uuid, date, text, int) IS 'Sprint-1: Atomic check-and-increment for entitlement limits. Service_role only. p_limit < 0 = unlimited.';

GRANT EXECUTE ON FUNCTION public.increment_usage_checked(uuid, date, text, int) TO service_role;

COMMIT;
