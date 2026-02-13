-- =============================================================================
-- Revenue Kernel PR-4: Reconciliation job queue (FOR UPDATE SKIP LOCKED).
-- site_usage_monthly is updated from COUNT(ingest_idempotency WHERE billable=true).
-- Invoice SoT remains ingest_idempotency; this table only drives the cron worker.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- billing_reconciliation_jobs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_reconciliation_jobs (
  id BIGSERIAL PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  year_month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  locked_at TIMESTAMPTZ NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  last_drift_pct NUMERIC NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_reconciliation_jobs_year_month_format CHECK (year_month ~ '^\d{4}-\d{2}$'),
  CONSTRAINT billing_reconciliation_jobs_status_check CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
  UNIQUE (site_id, year_month)
);

COMMENT ON TABLE public.billing_reconciliation_jobs IS
  'Revenue Kernel PR-4: Queue for reconciliation cron. Worker claims with FOR UPDATE SKIP LOCKED.';
COMMENT ON COLUMN public.billing_reconciliation_jobs.last_drift_pct IS
  'Drift % (|redis - pg|/pg*100) at last run; used for Watchtower billingReconciliationDriftLast1h.';

CREATE INDEX IF NOT EXISTS idx_billing_reconciliation_jobs_status_updated
  ON public.billing_reconciliation_jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_billing_reconciliation_jobs_site_year_month
  ON public.billing_reconciliation_jobs(site_id, year_month);

ALTER TABLE public.billing_reconciliation_jobs ENABLE ROW LEVEL SECURITY;

-- Only service_role writes; site members may SELECT their own site's jobs (optional).
CREATE POLICY "billing_reconciliation_jobs_select_site_members"
  ON public.billing_reconciliation_jobs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.billing_reconciliation_jobs.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid())
             OR public.is_admin(auth.uid()))
    )
  );

GRANT SELECT ON public.billing_reconciliation_jobs TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE ON public.billing_reconciliation_jobs TO service_role;

-- -----------------------------------------------------------------------------
-- RPC: Claim up to p_limit jobs (QUEUED or FAILED) with FOR UPDATE SKIP LOCKED
-- Returns claimed rows; caller then runs reconciliation and updates status.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_billing_reconciliation_jobs(p_limit INT)
RETURNS SETOF public.billing_reconciliation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row RECORD;
BEGIN
  FOR row IN
    SELECT b.id, b.site_id, b.year_month, b.status, b.locked_at, b.attempt_count,
           b.last_error, b.last_drift_pct, b.created_at, b.updated_at
    FROM public.billing_reconciliation_jobs b
    WHERE b.status IN ('QUEUED', 'FAILED')
    ORDER BY b.updated_at ASC
    LIMIT p_limit
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    UPDATE public.billing_reconciliation_jobs
    SET status = 'PROCESSING',
        locked_at = NOW(),
        attempt_count = attempt_count + 1,
        updated_at = NOW()
    WHERE id = row.id;
    RETURN NEXT row;
  END LOOP;
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.claim_billing_reconciliation_jobs(INT) IS
  'Revenue Kernel PR-4: Claim jobs for reconciliation worker. Concurrency-safe via FOR UPDATE SKIP LOCKED.';

COMMIT;
