-- =============================================================================
-- Revenue Kernel PR-1 P0/P1: ingest_idempotency write lock + index + site_plans trigger
-- P0: Tenant can read (dispute export) but NEVER update/delete; only service_role writes.
-- P1: year_month NOT NULL, extra partial index (billing_state), site_plans.updated_at trigger.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- P0: ingest_idempotency — SELECT for site members; UPDATE/DELETE only service_role
-- Data access rule: billable / billing_state only writable by service_role/reconciliation.
-- -----------------------------------------------------------------------------

-- Allow authenticated to SELECT only rows for sites they are member of (dispute export).
CREATE POLICY "ingest_idempotency_select_site_members"
  ON public.ingest_idempotency FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.ingest_idempotency.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid())
             OR public.is_admin(auth.uid()))
    )
  );

COMMENT ON POLICY "ingest_idempotency_select_site_members" ON public.ingest_idempotency IS
  'Revenue Kernel: site members can read for dispute export. No INSERT/UPDATE/DELETE for authenticated; only service_role.';

-- Authenticated: no INSERT/UPDATE/DELETE (no policy = no access). Service_role keeps full write.
GRANT SELECT ON public.ingest_idempotency TO authenticated;
GRANT UPDATE ON public.ingest_idempotency TO service_role;

-- Explicit: year_month is never null (generated from created_at which is NOT NULL).
ALTER TABLE public.ingest_idempotency
  ALTER COLUMN year_month SET NOT NULL;

-- -----------------------------------------------------------------------------
-- P1: Partial index for reconciliation by billing_state (overage/accepted split)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ingest_idempotency_site_year_month_billing_billable
  ON public.ingest_idempotency(site_id, year_month, billing_state)
  WHERE billable = true;

COMMENT ON INDEX public.idx_ingest_idempotency_site_year_month_billing_billable IS
  'Revenue Kernel: reconciliation by (site_id, year_month, billing_state) for billable rows.';

-- -----------------------------------------------------------------------------
-- P1: site_plans.updated_at — auto-set on UPDATE
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_plans_updated_at ON public.site_plans;
CREATE TRIGGER site_plans_updated_at
  BEFORE UPDATE ON public.site_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON FUNCTION public.set_updated_at() IS
  'Standard trigger: set updated_at = NOW() on row update.';

COMMIT;
