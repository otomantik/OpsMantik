BEGIN;

-- calls row updates are covered by tr_updated_at (public.handle_updated_at),
-- so calls must expose updated_at like other OCI/runtime tables.
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMIT;
