BEGIN;

CREATE TABLE IF NOT EXISTS public.billing_reconciliation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  year_month text NOT NULL CHECK (year_month ~ '^\d{4}-\d{2}$'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text NULL,
  last_drift_pct numeric NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_billing_reconciliation_jobs_status_updated
  ON public.billing_reconciliation_jobs(status, updated_at);

CREATE OR REPLACE FUNCTION public.claim_billing_reconciliation_jobs(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  site_id uuid,
  year_month text,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH locked AS (
    SELECT j.id
    FROM public.billing_reconciliation_jobs j
    WHERE j.status IN ('PENDING', 'FAILED')
    ORDER BY j.updated_at ASC, j.created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500))
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.billing_reconciliation_jobs j
    SET
      status = 'PROCESSING',
      attempt_count = j.attempt_count + 1,
      started_at = now(),
      updated_at = now(),
      last_error = NULL
    FROM locked l
    WHERE j.id = l.id
    RETURNING j.id, j.site_id, j.year_month, j.attempt_count
  )
  SELECT u.id, u.site_id, u.year_month, u.attempt_count
  FROM upd u;
END;
$$;

ALTER TABLE public.billing_reconciliation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_reconciliation_jobs_write_service_role ON public.billing_reconciliation_jobs;
CREATE POLICY billing_reconciliation_jobs_write_service_role
ON public.billing_reconciliation_jobs
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON TABLE public.billing_reconciliation_jobs TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_billing_reconciliation_jobs(integer) TO service_role;

COMMIT;
