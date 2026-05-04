-- Partial index for stale REGISTERED ack receipts (result not yet frozen).
-- Supports sweep/cron queries: REGISTERED rows with NULL result_snapshot by age.

BEGIN;

CREATE INDEX IF NOT EXISTS ack_receipt_ledger_stale_registered_created_idx
  ON public.ack_receipt_ledger USING btree (created_at)
  WHERE apply_state = 'REGISTERED' AND result_snapshot IS NULL;

COMMENT ON INDEX public.ack_receipt_ledger_stale_registered_created_idx IS
  'Hot path: find stale REGISTERED ack receipts awaiting result_snapshot (sweep / monitoring).';

COMMIT;
