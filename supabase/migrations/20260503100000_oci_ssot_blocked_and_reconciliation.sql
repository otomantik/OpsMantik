-- OCI SSOT: BLOCKED_PRECEDING_SIGNALS for won queue ordering, reconciliation audit events.

BEGIN;

-- ---------------------------------------------------------------------------
-- offline_conversion_queue: block metadata + extended status CHECK
-- ---------------------------------------------------------------------------
ALTER TABLE public.offline_conversion_queue
  ADD COLUMN IF NOT EXISTS block_reason text,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz;

ALTER TABLE public.offline_conversion_queue
  DROP CONSTRAINT IF EXISTS offline_conversion_queue_status_check;

ALTER TABLE public.offline_conversion_queue
  ADD CONSTRAINT offline_conversion_queue_status_check CHECK (
    status = ANY (
      ARRAY[
        'QUEUED',
        'RETRY',
        'PROCESSING',
        'UPLOADED',
        'COMPLETED',
        'COMPLETED_UNVERIFIED',
        'FAILED',
        'DEAD_LETTER_QUARANTINE',
        'VOIDED_BY_REVERSAL',
        'BLOCKED_PRECEDING_SIGNALS'
      ]
    )
  );

COMMENT ON COLUMN public.offline_conversion_queue.block_reason IS 'When status=BLOCKED_PRECEDING_SIGNALS: e.g. PRECEDING_SIGNALS_NOT_EXPORTED';
COMMENT ON COLUMN public.offline_conversion_queue.blocked_at IS 'When row entered BLOCKED_PRECEDING_SIGNALS';

-- ---------------------------------------------------------------------------
-- oci_reconciliation_events: append-only, idempotent dedupe
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oci_reconciliation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites (id) ON DELETE CASCADE,
  call_id uuid,
  stage text NOT NULL,
  reason text NOT NULL,
  expected_conversion_name text,
  result text NOT NULL DEFAULT 'skipped',
  evidence_hash text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS oci_reconciliation_events_dedupe_uidx
  ON public.oci_reconciliation_events (site_id, call_id, stage, reason, evidence_hash);

CREATE INDEX IF NOT EXISTS oci_reconciliation_events_site_created_idx
  ON public.oci_reconciliation_events (site_id, created_at DESC);

ALTER TABLE public.oci_reconciliation_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.oci_reconciliation_events IS 'Append-only OCI reconciliation audit; INSERT idempotent via dedupe unique index.';

COMMIT;
