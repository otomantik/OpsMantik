-- OCI-9D: Partition join invariant — session_created_month NOT NULL when matched_session_id present.
-- Ensures get_call_session_for_oci JOIN always has partition key for calls with session.
BEGIN;

-- 1) Backfill any remaining NULLs (matched_session_id present => session_created_month required)
UPDATE public.calls c
SET session_created_month = date_trunc('month', (COALESCE(c.matched_at, c.created_at, now()) AT TIME ZONE 'utc'))::date
WHERE c.session_created_month IS NULL
  AND c.matched_session_id IS NOT NULL;

-- 2) Add CHECK: when matched_session_id is set, session_created_month must be set
ALTER TABLE public.calls
  ADD CONSTRAINT calls_session_created_month_invariant
  CHECK (matched_session_id IS NULL OR session_created_month IS NOT NULL);

COMMENT ON CONSTRAINT calls_session_created_month_invariant ON public.calls IS
  'OCI-9: Partition join invariant. Enables get_call_session_for_oci s.created_month = c.session_created_month.';

COMMIT;
