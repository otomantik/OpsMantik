-- =============================================================================
-- Conversation Layer: Kernel-grade hardening
-- 1) Trigger: conversation_links entity must belong to same site as conversation
-- 2) RPC: update_offline_conversion_queue_attribution only when queue status in QUEUED/PROCESSING (immutable after COMPLETED/FAILED)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Function: validate conversation_links entity site match
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conversation_links_entity_site_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_id uuid;
  v_ok boolean := false;
BEGIN
  SELECT c.site_id INTO v_site_id
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id
  LIMIT 1;

  IF v_site_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'conversation_links: conversation not found', ERRCODE = 'P0001';
  END IF;

  CASE NEW.entity_type
    WHEN 'call' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.calls
        WHERE id = NEW.entity_id AND site_id = v_site_id
      ) INTO v_ok;
    WHEN 'session' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.sessions
        WHERE id = NEW.entity_id AND site_id = v_site_id
      ) INTO v_ok;
    WHEN 'event' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.events
        WHERE id = NEW.entity_id AND site_id = v_site_id
      ) INTO v_ok;
    ELSE
      RAISE EXCEPTION USING MESSAGE = 'conversation_links: invalid entity_type', ERRCODE = 'P0001';
  END CASE;

  IF NOT v_ok THEN
    RAISE EXCEPTION USING MESSAGE = 'conversation_links: entity must belong to the same site as the conversation',
      ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.conversation_links_entity_site_check() IS
  'Trigger: ensures conversation_links.entity_id references a call/session/event in the same site as the conversation.';

DROP TRIGGER IF EXISTS conversation_links_entity_site_trigger ON public.conversation_links;
CREATE TRIGGER conversation_links_entity_site_trigger
  BEFORE INSERT OR UPDATE OF conversation_id, entity_type, entity_id
  ON public.conversation_links
  FOR EACH ROW
  EXECUTE FUNCTION public.conversation_links_entity_site_check();

-- -----------------------------------------------------------------------------
-- 2) RPC: update_offline_conversion_queue_attribution — immutable after COMPLETED/FAILED
--    Only update when queue row status IN ('QUEUED','PROCESSING').
--    Tenant check unchanged.
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
  v_uid uuid;
  v_queue_status text;
BEGIN
  v_uid := auth.uid();

  SELECT * INTO v_sale FROM public.sales WHERE public.sales.id = p_sale_id FOR UPDATE;

  IF NOT FOUND OR v_sale.status IS DISTINCT FROM 'CONFIRMED' OR v_sale.conversation_id IS NULL THEN
    RETURN;
  END IF;

  -- Tenant isolation: authenticated callers must have access to sale's site
  IF v_uid IS NOT NULL THEN
    IF NOT public.can_access_site(v_uid, v_sale.site_id) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'Access denied to this site', ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT q.status INTO v_queue_status
  FROM public.offline_conversion_queue q
  WHERE q.sale_id = p_sale_id AND q.site_id = v_sale.site_id
  LIMIT 1;

  IF v_queue_status IS NULL THEN
    RETURN;
  END IF;

  IF v_queue_status NOT IN ('QUEUED', 'PROCESSING') THEN
    RAISE EXCEPTION USING MESSAGE = 'immutable_after_sent',
      DETAIL = 'Queue attribution cannot be updated when status is ' || COALESCE(v_queue_status, 'unknown'),
      ERRCODE = 'P0001';
  END IF;

  SELECT c.primary_source INTO v_primary_source
  FROM public.conversations c
  WHERE c.id = v_sale.conversation_id
  LIMIT 1;
  IF v_primary_source IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.offline_conversion_queue q
  SET
    gclid = COALESCE(v_primary_source->>'gclid', q.gclid),
    wbraid = COALESCE(v_primary_source->>'wbraid', q.wbraid),
    gbraid = COALESCE(v_primary_source->>'gbraid', q.gbraid),
    updated_at = now()
  WHERE q.sale_id = p_sale_id
    AND q.site_id = v_sale.site_id
    AND q.status IN ('QUEUED', 'PROCESSING');
END;
$$;

COMMENT ON FUNCTION public.update_offline_conversion_queue_attribution(uuid) IS
  'P1 Late linking: backfill gclid/wbraid/gbraid from conversation. Only when queue status is QUEUED or PROCESSING; immutable after COMPLETED/FAILED. Enforces tenant access.';

COMMIT;
