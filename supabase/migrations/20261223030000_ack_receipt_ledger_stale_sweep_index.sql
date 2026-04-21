BEGIN;

-- Panoptic Phase 5: index support for `sweep_stale_ack_receipts_v1` hot path
-- (REGISTERED + no snapshot, ordered by created_at FOR UPDATE SKIP LOCKED).

CREATE INDEX IF NOT EXISTS ack_receipt_ledger_stale_registered_created_idx
  ON public.ack_receipt_ledger (created_at)
  WHERE apply_state = 'REGISTERED'
    AND result_snapshot IS NULL;

COMMENT ON INDEX public.ack_receipt_ledger_stale_registered_created_idx IS
  'Partial index for stale REGISTERED ack receipts (liveness sweep ordering).';

COMMIT;
