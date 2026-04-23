BEGIN;

-- Runtime code writes modern billing/idempotency fields; baseline table still had legacy required columns.
ALTER TABLE public.ingest_idempotency
  ALTER COLUMN canonical_action DROP NOT NULL,
  ALTER COLUMN canonical_target DROP NOT NULL,
  ALTER COLUMN request_hash DROP NOT NULL;

ALTER TABLE public.ingest_idempotency
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS idempotency_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS billable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS billing_state text NOT NULL DEFAULT 'ACCEPTED',
  ADD COLUMN IF NOT EXISTS billing_reason text NULL,
  ADD COLUMN IF NOT EXISTS event_category text NULL,
  ADD COLUMN IF NOT EXISTS event_action text NULL,
  ADD COLUMN IF NOT EXISTS event_label text NULL,
  ADD COLUMN IF NOT EXISTS year_month date NULL;

UPDATE public.ingest_idempotency
SET
  created_at = COALESCE(created_at, first_seen_at, now()),
  year_month = COALESCE(year_month, date_trunc('month', COALESCE(created_at, first_seen_at, now()))::date),
  billing_state = COALESCE(NULLIF(billing_state, ''), CASE WHEN billable THEN 'ACCEPTED' ELSE 'REJECTED_QUOTA' END);

ALTER TABLE public.ingest_idempotency
  ALTER COLUMN year_month SET DEFAULT date_trunc('month', now())::date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ingest_idempotency_billing_state_check'
  ) THEN
    ALTER TABLE public.ingest_idempotency
      ADD CONSTRAINT ingest_idempotency_billing_state_check
      CHECK (billing_state IN ('ACCEPTED', 'OVERAGE', 'REJECTED_QUOTA'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ingest_idempotency_site_created
  ON public.ingest_idempotency(site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingest_idempotency_site_month_billable
  ON public.ingest_idempotency(site_id, year_month, billable);

COMMIT;
