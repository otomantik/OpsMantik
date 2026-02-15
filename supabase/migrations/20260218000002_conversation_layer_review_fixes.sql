-- Conversation Layer: review fixes (P1 late linking backfill, P2 cron index)
-- P1: When a conversation is linked to an already-CONFIRMED sale, backfill queue attribution.
-- P2: Composite index for cron "CONFIRMED sales in last N hours".

BEGIN;

-- -----------------------------------------------------------------------------
-- P2: Index for cron enqueue-from-sales (status + occurred_at)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sales_status_occurred_at
  ON public.sales(status, occurred_at DESC);

COMMENT ON INDEX public.idx_sales_status_occurred_at IS
  'Cron enqueue-from-sales: CONFIRMED sales in time window.';

-- -----------------------------------------------------------------------------
-- P1: RPC to backfill gclid/wbraid/gbraid when conversation is linked after confirm
--     (Late linking: sale was confirmed before conversation attached.)
--     Call from app after setting sale.conversation_id (e.g. in resolve).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_offline_conversion_queue_attribution(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_primary_source jsonb;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id LIMIT 1;
  IF NOT FOUND OR v_sale.status IS DISTINCT FROM 'CONFIRMED' OR v_sale.conversation_id IS NULL THEN
    RETURN;
  END IF;

  SELECT c.primary_source INTO v_primary_source
  FROM public.conversations c WHERE c.id = v_sale.conversation_id LIMIT 1;
  IF v_primary_source IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.offline_conversion_queue
  SET
    gclid = COALESCE(v_primary_source->>'gclid', gclid),
    wbraid = COALESCE(v_primary_source->>'wbraid', wbraid),
    gbraid = COALESCE(v_primary_source->>'gbraid', gbraid),
    updated_at = now()
  WHERE sale_id = p_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_offline_conversion_queue_attribution(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_offline_conversion_queue_attribution(uuid) TO service_role;

COMMENT ON FUNCTION public.update_offline_conversion_queue_attribution(uuid) IS
  'P1 Late linking: backfill gclid/wbraid/gbraid from conversation when conversation is linked to an already CONFIRMED sale.';

COMMIT;
