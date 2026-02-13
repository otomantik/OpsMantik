-- =============================================================================
-- PR-9: Scale ingest_idempotency via monthly RANGE(created_at) partitioning.
-- - Partition key: created_at (required for PK; generated column cannot be key).
-- - PK: (site_id, idempotency_key, created_at) so constraint includes partition key.
-- - Same columns and semantics; UNIQUE enforced per partition.
-- - Minimal-downtime: create new table, copy under brief lock, swap names.
-- - Rollback: swap names back and drop new table (see docs/BILLING/PR9_IDEMPOTENCY_SCALING.md).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Create partitioned table (same columns, PK includes created_at)
-- -----------------------------------------------------------------------------
CREATE TABLE public.ingest_idempotency_new (
    site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    billing_state public.billing_state NOT NULL DEFAULT 'ACCEPTED',
    billable BOOLEAN NOT NULL DEFAULT true,
    year_month TEXT NOT NULL GENERATED ALWAYS AS (public.utc_year_month(created_at)) STORED,
    idempotency_version SMALLINT NOT NULL DEFAULT 1,
    PRIMARY KEY (site_id, idempotency_key, created_at)
) PARTITION BY RANGE (created_at);

COMMENT ON TABLE public.ingest_idempotency_new IS
    'PR-9: Partitioned ingest_idempotency by month (RANGE created_at). Same semantics as ingest_idempotency.';

-- -----------------------------------------------------------------------------
-- 2) Create partitions: existing data months + next 12 months (UTC)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    min_ts TIMESTAMPTZ;
    max_ts TIMESTAMPTZ;
    p_start TIMESTAMPTZ;
    p_end TIMESTAMPTZ;
    p_name TEXT;
BEGIN
    SELECT date_trunc('month', COALESCE(MIN(created_at), NOW())),
           date_trunc('month', COALESCE(MAX(created_at), NOW())) + INTERVAL '1 month'
      INTO min_ts, max_ts
      FROM public.ingest_idempotency;

    -- Cover existing data months + 12 future months from now
    min_ts := LEAST(min_ts, date_trunc('month', NOW()) - INTERVAL '1 month');
    max_ts := GREATEST(max_ts, date_trunc('month', NOW()) + INTERVAL '13 months');

    p_start := min_ts;
    WHILE p_start < max_ts LOOP
        p_end := p_start + INTERVAL '1 month';
        p_name := 'ingest_idempotency_new_' || to_char(p_start AT TIME ZONE 'UTC', 'YYYY_MM');
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.ingest_idempotency_new FOR VALUES FROM (%L) TO (%L)',
            p_name, p_start, p_end
        );
        p_start := p_end;
    END LOOP;
END$$;

-- -----------------------------------------------------------------------------
-- 3) Indexes (created on parent; propagate to all current partitions)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ingest_idempotency_new_expires_at
    ON public.ingest_idempotency_new(expires_at);

CREATE INDEX IF NOT EXISTS idx_ingest_idempotency_new_site_year_month_billable
    ON public.ingest_idempotency_new(site_id, year_month)
    WHERE billable = true;

CREATE INDEX IF NOT EXISTS idx_ingest_idempotency_new_site_year_month_billing_billable
    ON public.ingest_idempotency_new(site_id, year_month, billing_state)
    WHERE billable = true;

CREATE INDEX IF NOT EXISTS idx_ingest_idempotency_new_site_year_month_version_billable
    ON public.ingest_idempotency_new(site_id, year_month, idempotency_version)
    WHERE billable = true;

-- -----------------------------------------------------------------------------
-- 4) RLS and policies (match current table)
-- -----------------------------------------------------------------------------
ALTER TABLE public.ingest_idempotency_new ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ingest_idempotency_new_select_site_members"
  ON public.ingest_idempotency_new FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.ingest_idempotency_new.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid())
             OR public.is_admin(auth.uid()))
    )
  );

GRANT SELECT ON public.ingest_idempotency_new TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE ON public.ingest_idempotency_new TO service_role;

-- -----------------------------------------------------------------------------
-- 5) Copy data under lock, then swap (minimal downtime = copy duration)
-- -----------------------------------------------------------------------------
LOCK TABLE public.ingest_idempotency IN ACCESS EXCLUSIVE MODE;

INSERT INTO public.ingest_idempotency_new (site_id, idempotency_key, created_at, expires_at, billing_state, billable, idempotency_version)
SELECT site_id, idempotency_key, created_at, expires_at, billing_state, billable, idempotency_version
FROM public.ingest_idempotency;

ALTER TABLE public.ingest_idempotency RENAME TO ingest_idempotency_pr9_backup;
ALTER TABLE public.ingest_idempotency_new RENAME TO ingest_idempotency;

-- Policy name: align with original (ingest_idempotency_select_site_members)
ALTER POLICY "ingest_idempotency_new_select_site_members" ON public.ingest_idempotency
  RENAME TO "ingest_idempotency_select_site_members";

COMMIT;

-- -----------------------------------------------------------------------------
-- 6) Partition maintenance: call monthly to ensure next month partition exists
-- (e.g. from pg_cron or external cron). Idempotent.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ingest_idempotency_ensure_next_partition()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    next_month_start TIMESTAMPTZ;
    next_month_end   TIMESTAMPTZ;
    p_name           TEXT;
BEGIN
    next_month_start := date_trunc('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month';
    next_month_end   := next_month_start + INTERVAL '1 month';
    p_name := 'ingest_idempotency_' || to_char(next_month_start AT TIME ZONE 'UTC', 'YYYY_MM');

    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.ingest_idempotency FOR VALUES FROM (%L) TO (%L)',
        p_name, next_month_start, next_month_end
    );
END;
$$;

COMMENT ON FUNCTION public.ingest_idempotency_ensure_next_partition() IS
    'PR-9: Ensure next month partition exists for ingest_idempotency. Run monthly (pg_cron or external).';

GRANT EXECUTE ON FUNCTION public.ingest_idempotency_ensure_next_partition() TO service_role;
