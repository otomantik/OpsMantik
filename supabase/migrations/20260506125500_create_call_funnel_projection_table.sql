BEGIN;

CREATE TABLE IF NOT EXISTS public.call_funnel_projection (
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  highest_stage text NOT NULL DEFAULT 'junk',
  current_stage text NOT NULL DEFAULT 'junk',
  contacted_at timestamptz NULL,
  offered_at timestamptz NULL,
  won_at timestamptz NULL,
  quality_score integer NULL CHECK (quality_score BETWEEN 1 AND 5),
  funnel_completeness text NOT NULL DEFAULT 'incomplete',
  export_status text NOT NULL DEFAULT 'BLOCKED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, call_id)
);

CREATE INDEX IF NOT EXISTS idx_call_funnel_projection_call_site
  ON public.call_funnel_projection(call_id, site_id);

CREATE INDEX IF NOT EXISTS idx_call_funnel_projection_site_export_status
  ON public.call_funnel_projection(site_id, export_status, updated_at DESC);

ALTER TABLE public.call_funnel_projection ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_funnel_projection_select_site_members ON public.call_funnel_projection;
CREATE POLICY call_funnel_projection_select_site_members
ON public.call_funnel_projection
FOR SELECT
USING (public._can_access_site(site_id));

DROP POLICY IF EXISTS call_funnel_projection_write_service_role ON public.call_funnel_projection;
CREATE POLICY call_funnel_projection_write_service_role
ON public.call_funnel_projection
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON TABLE public.call_funnel_projection TO service_role;
GRANT SELECT ON TABLE public.call_funnel_projection TO authenticated;

COMMIT;
