BEGIN;

CREATE OR REPLACE FUNCTION public.sales_finalized_identity_immutable_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'DRAFT'
     AND (
       NEW.site_id IS DISTINCT FROM OLD.site_id
       OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
       OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.external_ref IS DISTINCT FROM OLD.external_ref
       OR NEW.customer_hash IS DISTINCT FROM OLD.customer_hash
     ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'sales: finalized identity fields are immutable',
      ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sales_finalized_identity_immutable_check() IS
  'Trigger: prevents non-DRAFT sales from mutating monetary identity fields during external_ref replays or manual writes.';

DROP TRIGGER IF EXISTS sales_finalized_identity_immutable_trigger ON public.sales;
CREATE TRIGGER sales_finalized_identity_immutable_trigger
  BEFORE UPDATE OF site_id, occurred_at, amount_cents, currency, external_ref, customer_hash
  ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.sales_finalized_identity_immutable_check();

CREATE OR REPLACE FUNCTION public.resolve_conversation_with_sale_link(
  p_conversation_id uuid,
  p_status text,
  p_note text DEFAULT NULL,
  p_sale_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation public.conversations%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_uid uuid;
BEGIN
  IF p_status NOT IN ('WON', 'LOST', 'JUNK') THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_status', ERRCODE = 'P0001';
  END IF;

  v_uid := auth.uid();

  SELECT * INTO v_conversation
  FROM public.conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'conversation_not_found', ERRCODE = 'P0001';
  END IF;

  IF v_uid IS NOT NULL AND NOT public.can_access_site(v_uid, v_conversation.site_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
  END IF;

  IF p_sale_id IS NOT NULL THEN
    SELECT * INTO v_sale
    FROM public.sales
    WHERE id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'sale_not_found', ERRCODE = 'P0001';
    END IF;

    IF v_sale.site_id IS DISTINCT FROM v_conversation.site_id THEN
      RAISE EXCEPTION USING MESSAGE = 'sale_site_mismatch', ERRCODE = 'P0001';
    END IF;

    IF v_sale.conversation_id IS NOT NULL AND v_sale.conversation_id IS DISTINCT FROM v_conversation.id THEN
      RAISE EXCEPTION USING MESSAGE = 'sale_already_linked_elsewhere', ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.conversations
  SET
    status = p_status,
    note = CASE WHEN p_note IS NULL THEN note ELSE p_note END,
    updated_at = now()
  WHERE id = v_conversation.id
  RETURNING * INTO v_conversation;

  IF p_sale_id IS NOT NULL THEN
    UPDATE public.sales
    SET
      conversation_id = v_conversation.id,
      updated_at = now()
    WHERE id = p_sale_id
    RETURNING * INTO v_sale;

    IF v_sale.status = 'CONFIRMED' THEN
      PERFORM public.update_offline_conversion_queue_attribution(p_sale_id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_conversation.id,
    'site_id', v_conversation.site_id,
    'status', v_conversation.status,
    'note', v_conversation.note,
    'primary_call_id', v_conversation.primary_call_id,
    'primary_session_id', v_conversation.primary_session_id,
    'primary_source', v_conversation.primary_source,
    'created_at', v_conversation.created_at,
    'updated_at', v_conversation.updated_at
  );
END;
$$;

COMMENT ON FUNCTION public.resolve_conversation_with_sale_link(uuid, text, text, uuid) IS
  'Atomically resolves a conversation, optionally links a same-site sale, and backfills OCI attribution before any split-brain state can be committed.';

GRANT EXECUTE ON FUNCTION public.resolve_conversation_with_sale_link(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_conversation_with_sale_link(uuid, text, text, uuid) TO service_role;

COMMIT;
