BEGIN;

CREATE TABLE IF NOT EXISTS public.site_plans (
  site_id uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  monthly_limit integer NOT NULL DEFAULT 100000 CHECK (monthly_limit > 0),
  soft_limit_enabled boolean NOT NULL DEFAULT true,
  hard_cap_multiplier integer NOT NULL DEFAULT 2 CHECK (hard_cap_multiplier >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.site_usage_monthly (
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  year_month text NOT NULL CHECK (year_month ~ '^\d{4}-\d{2}$'),
  event_count integer NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  overage_count integer NOT NULL DEFAULT 0 CHECK (overage_count >= 0),
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, year_month)
);

CREATE TABLE IF NOT EXISTS public.usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  month date NOT NULL,
  revenue_events_count bigint NOT NULL DEFAULT 0 CHECK (revenue_events_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, month)
);

CREATE TABLE IF NOT EXISTS public.call_funnel_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_family text NOT NULL DEFAULT 'FUNNEL',
  event_source text NOT NULL,
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  causation_id text NULL,
  correlation_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_site_usage_monthly_site_year_month
  ON public.site_usage_monthly(site_id, year_month);

CREATE INDEX IF NOT EXISTS idx_usage_counters_site_month
  ON public.usage_counters(site_id, month);

CREATE INDEX IF NOT EXISTS idx_call_funnel_ledger_site_created
  ON public.call_funnel_ledger(site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_funnel_ledger_call_created
  ON public.call_funnel_ledger(call_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.increment_usage_checked(
  p_site_id uuid,
  p_month date,
  p_kind text,
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.usage_counters%ROWTYPE;
  v_current bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.usage_counters(site_id, month)
  VALUES (p_site_id, p_month)
  ON CONFLICT (site_id, month) DO NOTHING;

  SELECT *
  INTO v_row
  FROM public.usage_counters
  WHERE site_id = p_site_id
    AND month = p_month
  FOR UPDATE;

  IF p_kind <> 'revenue_events' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'UNSUPPORTED_KIND',
      'kind', p_kind
    );
  END IF;

  v_current := COALESCE(v_row.revenue_events_count, 0);

  IF p_limit >= 0 AND v_current >= p_limit THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'LIMIT',
      'kind', p_kind,
      'current', v_current,
      'limit', p_limit
    );
  END IF;

  UPDATE public.usage_counters
  SET
    revenue_events_count = v_current + 1,
    updated_at = now()
  WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', p_kind,
    'current', v_current + 1,
    'limit', p_limit
  );
END;
$$;

ALTER TABLE public.site_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_usage_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_funnel_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS site_plans_select_site_members ON public.site_plans;
CREATE POLICY site_plans_select_site_members
ON public.site_plans
FOR SELECT
USING (public._can_access_site(site_id));

DROP POLICY IF EXISTS site_plans_write_service_role ON public.site_plans;
CREATE POLICY site_plans_write_service_role
ON public.site_plans
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS site_usage_monthly_select_site_members ON public.site_usage_monthly;
CREATE POLICY site_usage_monthly_select_site_members
ON public.site_usage_monthly
FOR SELECT
USING (public._can_access_site(site_id));

DROP POLICY IF EXISTS site_usage_monthly_write_service_role ON public.site_usage_monthly;
CREATE POLICY site_usage_monthly_write_service_role
ON public.site_usage_monthly
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS usage_counters_select_site_members ON public.usage_counters;
CREATE POLICY usage_counters_select_site_members
ON public.usage_counters
FOR SELECT
USING (public._can_access_site(site_id));

DROP POLICY IF EXISTS usage_counters_write_service_role ON public.usage_counters;
CREATE POLICY usage_counters_write_service_role
ON public.usage_counters
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS call_funnel_ledger_select_site_members ON public.call_funnel_ledger;
CREATE POLICY call_funnel_ledger_select_site_members
ON public.call_funnel_ledger
FOR SELECT
USING (public._can_access_site(site_id));

DROP POLICY IF EXISTS call_funnel_ledger_write_service_role ON public.call_funnel_ledger;
CREATE POLICY call_funnel_ledger_write_service_role
ON public.call_funnel_ledger
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON TABLE public.site_plans TO service_role;
GRANT ALL ON TABLE public.site_usage_monthly TO service_role;
GRANT ALL ON TABLE public.usage_counters TO service_role;
GRANT ALL ON TABLE public.call_funnel_ledger TO service_role;
GRANT SELECT ON TABLE public.site_plans TO authenticated;
GRANT SELECT ON TABLE public.site_usage_monthly TO authenticated;
GRANT SELECT ON TABLE public.usage_counters TO authenticated;
GRANT SELECT ON TABLE public.call_funnel_ledger TO authenticated;

GRANT EXECUTE ON FUNCTION public.increment_usage_checked(uuid, date, text, integer) TO service_role;

COMMIT;
