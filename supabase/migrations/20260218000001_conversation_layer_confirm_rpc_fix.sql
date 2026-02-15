-- Fix ambiguous "sale_id" in confirm_sale_and_enqueue (RETURNS TABLE vs ON CONFLICT).
-- Use ON CONSTRAINT and RETURN QUERY SELECT so output column names don't shadow.

BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_sale_and_enqueue(p_sale_id uuid)
RETURNS TABLE(sale_id uuid, new_status text, enqueued boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_primary_source jsonb;
  v_queue_id uuid;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'sale_not_found', ERRCODE = 'P0001';
  END IF;

  IF v_sale.status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING MESSAGE = 'sale_already_confirmed_or_canceled', ERRCODE = 'P0001';
  END IF;

  UPDATE public.sales SET status = 'CONFIRMED', updated_at = now() WHERE id = p_sale_id;

  IF v_sale.conversation_id IS NOT NULL THEN
    SELECT c.primary_source INTO v_primary_source
    FROM public.conversations c WHERE c.id = v_sale.conversation_id LIMIT 1;
  END IF;

  INSERT INTO public.offline_conversion_queue (
    site_id, sale_id, conversion_time, value_cents, currency,
    gclid, wbraid, gbraid, status
  )
  VALUES (
    v_sale.site_id, v_sale.id, v_sale.occurred_at, v_sale.amount_cents, v_sale.currency,
    v_primary_source->>'gclid', v_primary_source->>'wbraid', v_primary_source->>'gbraid',
    'QUEUED'
  )
  ON CONFLICT ON CONSTRAINT offline_conversion_queue_sale_id_key DO NOTHING
  RETURNING id INTO v_queue_id;

  RETURN QUERY SELECT p_sale_id, 'CONFIRMED'::text, (v_queue_id IS NOT NULL);
END;
$$;

COMMIT;
