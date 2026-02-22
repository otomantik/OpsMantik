-- GDPR: confirm_sale_and_enqueue — marketing consent check before OCI enqueue
BEGIN;
CREATE OR REPLACE FUNCTION public.confirm_sale_and_enqueue(p_sale_id uuid)
RETURNS TABLE(sale_id uuid, new_status text, enqueued boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_primary_source jsonb;
  v_primary_session_id uuid;
  v_consent_scopes text[];
  v_queue_id uuid;
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  SELECT * INTO v_sale FROM public.sales WHERE public.sales.id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'sale_not_found', ERRCODE = 'P0001'; END IF;
  IF v_uid IS NOT NULL AND NOT public.can_access_site(v_uid, v_sale.site_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'Access denied to this site', ERRCODE = 'P0001';
  END IF;
  IF v_sale.status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING MESSAGE = 'sale_already_confirmed_or_canceled', ERRCODE = 'P0001';
  END IF;

  UPDATE public.sales SET status = 'CONFIRMED', updated_at = now() WHERE public.sales.id = p_sale_id;

  IF v_sale.conversation_id IS NOT NULL THEN
    SELECT c.primary_source, c.primary_session_id INTO v_primary_source, v_primary_session_id
    FROM public.conversations c WHERE c.id = v_sale.conversation_id LIMIT 1;

    IF v_primary_session_id IS NOT NULL THEN
      SELECT s.consent_scopes INTO v_consent_scopes FROM public.sessions s
      WHERE s.id = v_primary_session_id AND s.site_id = v_sale.site_id LIMIT 1;
      IF v_consent_scopes IS NOT NULL AND 'marketing' = ANY(v_consent_scopes) THEN
        INSERT INTO public.offline_conversion_queue (site_id, sale_id, conversion_time, value_cents, currency, gclid, wbraid, gbraid, status)
        VALUES (v_sale.site_id, v_sale.id, v_sale.occurred_at, v_sale.amount_cents, v_sale.currency,
          v_primary_source->>'gclid', v_primary_source->>'wbraid', v_primary_source->>'gbraid', 'QUEUED')
        ON CONFLICT ON CONSTRAINT offline_conversion_queue_sale_id_key DO NOTHING
        RETURNING public.offline_conversion_queue.id INTO v_queue_id;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT p_sale_id, 'CONFIRMED'::text, (v_queue_id IS NOT NULL);
END; $$;
COMMIT;
