-- =============================================================================
-- Seal → OCI Queue Bridge: Support call-originated conversions (no sale required)
-- Enables direct enqueue when user seals a deal from War Room.
-- =============================================================================

BEGIN;

-- Add call_id column for call-originated queue rows
ALTER TABLE public.offline_conversion_queue
  ADD COLUMN IF NOT EXISTS call_id uuid REFERENCES public.calls(id) ON DELETE CASCADE;

-- Make sale_id nullable (call-originated rows have call_id, sale-originated have sale_id)
ALTER TABLE public.offline_conversion_queue
  ALTER COLUMN sale_id DROP NOT NULL;

-- Ensure exactly one of sale_id or call_id is set
ALTER TABLE public.offline_conversion_queue
  DROP CONSTRAINT IF EXISTS offline_conversion_queue_sale_or_call_check;
ALTER TABLE public.offline_conversion_queue
  ADD CONSTRAINT offline_conversion_queue_sale_or_call_check
  CHECK (
    (sale_id IS NOT NULL AND call_id IS NULL) OR
    (sale_id IS NULL AND call_id IS NOT NULL)
  );

-- Keep offline_conversion_queue_sale_id_key (used by confirm_sale_and_enqueue RPC).
-- With sale_id nullable, UNIQUE(sale_id) allows multiple NULLs (call-originated rows).

-- Partial unique: one queue row per call (when call_id is set) - prevents double-enqueue on re-seal
CREATE UNIQUE INDEX IF NOT EXISTS offline_conversion_queue_call_id_key
  ON public.offline_conversion_queue (call_id)
  WHERE call_id IS NOT NULL;

COMMENT ON COLUMN public.offline_conversion_queue.call_id IS
  'Seal bridge: call-originated conversion (no sale). One of sale_id or call_id must be set.';

COMMIT;
