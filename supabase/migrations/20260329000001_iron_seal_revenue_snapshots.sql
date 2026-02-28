-- Iron Seal: revenue_snapshots & provider_dispatches — Immutable Financial Ledger.
-- APPEND-ONLY: No UPDATE/DELETE on revenue_snapshots. provider_dispatches: no DELETE.
-- Every conversion dispatch is a Financial Seal that cannot be undone.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) revenue_snapshots — Immutable record of sealed revenue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revenue_snapshots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid        NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  call_id       uuid        REFERENCES public.calls(id) ON DELETE SET NULL,
  sale_id       uuid,
  session_id    uuid,

  -- Financial
  value_cents   bigint      NOT NULL DEFAULT 0,
  currency      text        NOT NULL DEFAULT 'TRY',

  -- Audit / metadata
  reasons_json  jsonb       DEFAULT '{}',
  meta_json     jsonb       DEFAULT '{}',

  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.revenue_snapshots IS
  'Iron Seal: Immutable financial ledger. APPEND-ONLY. Every sealed conversion creates one row.';

-- Block UPDATE and DELETE on revenue_snapshots
CREATE OR REPLACE FUNCTION public._revenue_snapshots_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'revenue_snapshots is immutable: updates not allowed';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'revenue_snapshots is immutable: deletes not allowed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS revenue_snapshots_immutable ON public.revenue_snapshots;
CREATE TRIGGER revenue_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.revenue_snapshots
  FOR EACH ROW EXECUTE FUNCTION public._revenue_snapshots_immutable();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_revenue_snapshots_site_created
  ON public.revenue_snapshots (site_id, created_at);

CREATE INDEX IF NOT EXISTS idx_revenue_snapshots_call_id
  ON public.revenue_snapshots (call_id) WHERE call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rev_snapshots_reasons_gin
  ON public.revenue_snapshots USING GIN (reasons_json);

CREATE INDEX IF NOT EXISTS idx_rev_snapshots_meta_gin
  ON public.revenue_snapshots USING GIN (meta_json);

ALTER TABLE public.revenue_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "revenue_snapshots_service_role"
  ON public.revenue_snapshots FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

GRANT ALL ON public.revenue_snapshots TO service_role;

-- ---------------------------------------------------------------------------
-- 2) provider_dispatches — Dispatch audit (one per provider per snapshot)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_dispatches (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id      uuid        NOT NULL REFERENCES public.revenue_snapshots(id) ON DELETE RESTRICT,
  provider_key     text        NOT NULL DEFAULT 'google_ads',

  status           text        NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  next_retry_at    timestamptz,
  provider_request_id text,
  uploaded_at      timestamptz,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.provider_dispatches IS
  'Iron Seal: Dispatch audit per provider. Status updated by worker; row never deleted.';

-- Block DELETE on provider_dispatches
CREATE OR REPLACE FUNCTION public._provider_dispatches_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'provider_dispatches: deletes not allowed (audit trail)';
END;
$$;

DROP TRIGGER IF EXISTS provider_dispatches_no_delete ON public.provider_dispatches;
CREATE TRIGGER provider_dispatches_no_delete
  BEFORE DELETE ON public.provider_dispatches
  FOR EACH ROW EXECUTE FUNCTION public._provider_dispatches_no_delete();

-- updated_at trigger
CREATE OR REPLACE FUNCTION public._provider_dispatches_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provider_dispatches_set_updated_at ON public.provider_dispatches;
CREATE TRIGGER provider_dispatches_set_updated_at
  BEFORE UPDATE ON public.provider_dispatches
  FOR EACH ROW EXECUTE FUNCTION public._provider_dispatches_set_updated_at();

-- Partial index: worker claims PENDING only
CREATE INDEX IF NOT EXISTS idx_provider_dispatch_pending
  ON public.provider_dispatches (snapshot_id, provider_key, next_retry_at)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_provider_dispatches_snapshot
  ON public.provider_dispatches (snapshot_id);

ALTER TABLE public.provider_dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "provider_dispatches_service_role"
  ON public.provider_dispatches FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

GRANT ALL ON public.provider_dispatches TO service_role;

COMMIT;
