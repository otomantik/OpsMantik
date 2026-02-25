-- =============================================================================
-- Daily Google Ads spend ingestion (stealth): ad_spend_daily table
-- For webhook from Google Ads Script; tenant-scoped, idempotent upserts.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ad_spend_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  campaign_id text NOT NULL,
  campaign_name text NOT NULL,
  cost_cents integer NOT NULL,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  spend_date date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, campaign_id, spend_date)
);

COMMENT ON TABLE public.ad_spend_daily IS
  'Daily Google Ads spend per campaign, ingested via webhook. Money in cents. Idempotent by (site_id, campaign_id, spend_date).';

CREATE INDEX IF NOT EXISTS idx_ad_spend_daily_site_date
  ON public.ad_spend_daily (site_id, spend_date DESC);

-- -----------------------------------------------------------------------------
-- RLS: service_role writes; tenant admins (can_access_site) can SELECT
-- -----------------------------------------------------------------------------
ALTER TABLE public.ad_spend_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_spend_daily_select_via_site" ON public.ad_spend_daily;
CREATE POLICY "ad_spend_daily_select_via_site"
  ON public.ad_spend_daily FOR SELECT
  TO authenticated
  USING (public.can_access_site(auth.uid(), site_id));

-- No INSERT/UPDATE/DELETE for authenticated; only service_role can write.

GRANT SELECT ON public.ad_spend_daily TO authenticated;
GRANT INSERT, UPDATE, SELECT ON public.ad_spend_daily TO service_role;

COMMIT;
