-- =============================================================================
-- Revenue Kernel PR-1: Billing foundation schema (additive-only)
-- Invoice SoT = ingest_idempotency BILLABLE rows (site_id + month).
-- Redis / events / sessions are NOT invoice sources.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A) billing_state ENUM
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_state') THEN
    CREATE TYPE public.billing_state AS ENUM (
      'ACCEPTED',
      'OVERAGE',
      'DEGRADED_CAPTURE',
      'RECOVERED'
    );
  END IF;
END$$;

COMMENT ON TYPE public.billing_state IS
  'Revenue Kernel: billable row classification. ACCEPTED=normal ingest; OVERAGE=soft limit exceeded; DEGRADED_CAPTURE=fallback buffer; RECOVERED=recovered from buffer.';

-- -----------------------------------------------------------------------------
-- B) site_plans
-- RLS: site members can read; only site owner/admin or platform admin can write.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_plans (
  site_id UUID NOT NULL PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  plan_tier TEXT NOT NULL DEFAULT 'free',
  monthly_limit INT NOT NULL,
  soft_limit_enabled BOOLEAN NOT NULL DEFAULT false,
  hard_cap_multiplier NUMERIC NOT NULL DEFAULT 2,
  overage_price_per_1k NUMERIC NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.site_plans IS
  'Revenue Kernel: plan limits per site. Invoice authority remains ingest_idempotency only; this table drives quota/reconciliation.';
COMMENT ON COLUMN public.site_plans.monthly_limit IS 'Hard limit (events/month).';
COMMENT ON COLUMN public.site_plans.soft_limit_enabled IS 'If true, over-limit events are OVERAGE not rejected until hard_cap.';
COMMENT ON COLUMN public.site_plans.hard_cap_multiplier IS 'Hard cap = monthly_limit * this (e.g. 2 = 200% of plan).';

ALTER TABLE public.site_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_plans_select_site_members"
  ON public.site_plans FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.site_plans.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid())
             OR public.is_admin(auth.uid()))
    )
  );

CREATE POLICY "site_plans_insert_update_delete_admin"
  ON public.site_plans FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.site_plans.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid() AND sm.role = 'admin')
             OR public.is_admin(auth.uid()))
    )
  );

CREATE POLICY "site_plans_update_admin"
  ON public.site_plans FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.site_plans.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid() AND sm.role = 'admin')
             OR public.is_admin(auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.site_plans.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid() AND sm.role = 'admin')
             OR public.is_admin(auth.uid()))
    )
  );

CREATE POLICY "site_plans_delete_admin"
  ON public.site_plans FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.site_plans.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid() AND sm.role = 'admin')
             OR public.is_admin(auth.uid()))
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.site_plans TO service_role;
GRANT SELECT ON public.site_plans TO authenticated;

-- -----------------------------------------------------------------------------
-- C) site_usage_monthly (financial ledger snapshot for UI; not invoice authority)
-- year_month TEXT 'YYYY-MM' for consistency and simple range queries (UTC month).
-- RLS: site members read; only service_role writes (reconciliation cron).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_usage_monthly (
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  year_month TEXT NOT NULL,
  event_count BIGINT NOT NULL DEFAULT 0,
  overage_count BIGINT NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ NULL,
  PRIMARY KEY (site_id, year_month),
  CONSTRAINT site_usage_monthly_year_month_format CHECK (year_month ~ '^\d{4}-\d{2}$')
);

COMMENT ON TABLE public.site_usage_monthly IS
  'Revenue Kernel: monthly usage snapshot for UI. Invoice authority = ingest_idempotency only; this table is filled by reconciliation cron.';
COMMENT ON COLUMN public.site_usage_monthly.year_month IS 'YYYY-MM (UTC month).';

CREATE INDEX IF NOT EXISTS idx_site_usage_monthly_site_year_month
  ON public.site_usage_monthly(site_id, year_month);

ALTER TABLE public.site_usage_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_usage_monthly_select_site_members"
  ON public.site_usage_monthly FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.site_usage_monthly.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid())
             OR public.is_admin(auth.uid()))
    )
  );

-- No INSERT/UPDATE/DELETE for authenticated; only service_role (reconciliation) writes.
GRANT SELECT ON public.site_usage_monthly TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.site_usage_monthly TO service_role;

-- -----------------------------------------------------------------------------
-- D) invoice_snapshot (immutable, audit-proof)
-- RLS: site members read; only service_role can insert; trigger blocks UPDATE/DELETE.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_snapshot (
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  year_month TEXT NOT NULL,
  event_count BIGINT NOT NULL,
  overage_count BIGINT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by TEXT NULL,
  PRIMARY KEY (site_id, year_month),
  CONSTRAINT invoice_snapshot_year_month_format CHECK (year_month ~ '^\d{4}-\d{2}$')
);

COMMENT ON TABLE public.invoice_snapshot IS
  'Revenue Kernel: immutable audit snapshot per site/month. Invoice authority = ingest_idempotency; this is dispute-proof export. Do not update or delete.';

ALTER TABLE public.invoice_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoice_snapshot_select_site_members"
  ON public.invoice_snapshot FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.invoice_snapshot.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid())
             OR public.is_admin(auth.uid()))
    )
  );

-- Only service_role can insert (no policy = only service_role via grant).
GRANT SELECT, INSERT ON public.invoice_snapshot TO service_role;
GRANT SELECT ON public.invoice_snapshot TO authenticated;

-- Immutability: block UPDATE and DELETE for all roles (including service_role).
CREATE OR REPLACE FUNCTION public.invoice_snapshot_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'invoice_snapshot is immutable: updates and deletes are not allowed'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS invoice_snapshot_no_update ON public.invoice_snapshot;
CREATE TRIGGER invoice_snapshot_no_update
  BEFORE UPDATE ON public.invoice_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.invoice_snapshot_immutable();

DROP TRIGGER IF EXISTS invoice_snapshot_no_delete ON public.invoice_snapshot;
CREATE TRIGGER invoice_snapshot_no_delete
  BEFORE DELETE ON public.invoice_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.invoice_snapshot_immutable();

-- -----------------------------------------------------------------------------
-- E) Extend ingest_idempotency (additive only)
-- billing_state, billable, year_month for fast (site_id, year_month) counting.
-- Generated column requires an IMMUTABLE expression; to_char(timestamptz,...) is STABLE.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.utc_year_month(ts timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM');
$$;

COMMENT ON FUNCTION public.utc_year_month(timestamptz) IS
  'Revenue Kernel: UTC month YYYY-MM from timestamptz. Used by ingest_idempotency.year_month generated column.';

ALTER TABLE public.ingest_idempotency
  ADD COLUMN IF NOT EXISTS billing_state public.billing_state NOT NULL DEFAULT 'ACCEPTED',
  ADD COLUMN IF NOT EXISTS billable BOOLEAN NOT NULL DEFAULT true;

-- Generated column: invoice month in UTC (YYYY-MM) for reconciliation queries.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ingest_idempotency' AND column_name = 'year_month'
  ) THEN
    ALTER TABLE public.ingest_idempotency
      ADD COLUMN year_month TEXT GENERATED ALWAYS AS (public.utc_year_month(created_at)) STORED;
  END IF;
END$$;

COMMENT ON COLUMN public.ingest_idempotency.billing_state IS
  'Revenue Kernel: ACCEPTED=normal; OVERAGE=soft limit; DEGRADED_CAPTURE=fallback; RECOVERED=from buffer. Invoice authority = this table only.';
COMMENT ON COLUMN public.ingest_idempotency.billable IS
  'Revenue Kernel: true = row counts toward invoice. Duplicates/429 do not insert; fallback rows are billable at capture.';
COMMENT ON COLUMN public.ingest_idempotency.year_month IS
  'UTC month YYYY-MM for reconciliation. Generated from created_at.';

-- Partial index: fast COUNT for billable rows by (site_id, year_month).
CREATE INDEX IF NOT EXISTS idx_ingest_idempotency_site_year_month_billable
  ON public.ingest_idempotency(site_id, year_month)
  WHERE billable = true;

COMMENT ON INDEX public.idx_ingest_idempotency_site_year_month_billable IS
  'Revenue Kernel: reconciliation count by (site_id, year_month) for billable rows. Invoice SoT = this table only.';

-- -----------------------------------------------------------------------------
-- Verification queries (run manually; not part of migration)
-- -----------------------------------------------------------------------------
-- Invoice SoT count by site/month (billable rows only):
--   SELECT site_id, year_month, COUNT(*) AS event_count
--   FROM public.ingest_idempotency WHERE billable = true
--   GROUP BY site_id, year_month;
-- Usage ledger (UI):
--   SELECT * FROM public.site_usage_monthly WHERE site_id = '...' AND year_month >= '2025-01' AND year_month <= '2025-12';
-- Immutable snapshot (dispute export):
--   SELECT * FROM public.invoice_snapshot WHERE site_id = '...' AND year_month = '2025-01';

COMMIT;
