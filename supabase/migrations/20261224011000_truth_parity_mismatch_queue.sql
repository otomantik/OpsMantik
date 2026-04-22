-- Integrity remediation PR-5:
-- Detect-only truth parity mismatch capture + repair queue.

BEGIN;

CREATE TABLE IF NOT EXISTS public.truth_parity_mismatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mismatch_key text NOT NULL UNIQUE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  stream_kind text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'REPAIRED', 'DEAD_LETTER')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  repaired_at timestamptz NULL,
  last_error text NULL
);

CREATE INDEX IF NOT EXISTS idx_truth_parity_mismatches_open
  ON public.truth_parity_mismatches (status, detected_at)
  WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS public.truth_parity_repair_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mismatch_id uuid NOT NULL REFERENCES public.truth_parity_mismatches(id) ON DELETE CASCADE,
  dedup_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'DONE', 'DEAD_LETTER')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_error text NULL
);

CREATE INDEX IF NOT EXISTS idx_truth_parity_repair_queue_pending
  ON public.truth_parity_repair_queue (status, next_retry_at)
  WHERE status IN ('PENDING', 'PROCESSING');

COMMIT;
