-- =============================================================================
-- Conversation Layer: Paranoid security hardening for SECURITY DEFINER RPCs
-- - Tenant escape prevention via can_access_site(auth.uid(), site_id)
-- - claim_offline_conversion_jobs: service_role only
-- - Locking and deterministic updates for confirm + attribution
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Helper: can_access_site(p_user_id uuid, p_site_id uuid) -> boolean
-- Matches RLS: site owner, site_members member, or is_admin.
-- SECURITY DEFINER so it can be used inside other definer functions.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_site(p_user_id uuid, p_site_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL
    AND p_site_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = p_site_id
        AND (s.user_id = p_user_id
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = p_user_id)
             OR public.is_admin(p_user_id))
    );
$$;

COMMENT ON FUNCTION public.can_access_site(uuid, uuid) IS
  'Tenant check: true if user is site owner, site_member, or admin. Used by SECURITY DEFINER RPCs to enforce tenant isolation.';

-- Grant so authenticated/definer callers can execute (used inside definer functions)
GRANT EXECUTE ON FUNCTION public.can_access_site(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_site(uuid, uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- 2) confirm_sale_and_enqueue — tenant check + preserve contract
-- -----------------------------------------------------------------------------
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
  v_uid uuid;
BEGIN
  v_uid := auth.uid();

  SELECT * INTO v_sale FROM public.sales WHERE public.sales.id = p_sale_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'sale_not_found', ERRCODE = 'P0001';
  END IF;

  -- Tenant isolation: authenticated callers must have access to sale's site
  IF v_uid IS NOT NULL THEN
    IF NOT public.can_access_site(v_uid, v_sale.site_id) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'Access denied to this site', ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_sale.status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING MESSAGE = 'sale_already_confirmed_or_canceled', ERRCODE = 'P0001';
  END IF;

  UPDATE public.sales
  SET status = 'CONFIRMED', updated_at = now()
  WHERE public.sales.id = p_sale_id;

  IF v_sale.conversation_id IS NOT NULL THEN
    SELECT c.primary_source INTO v_primary_source
    FROM public.conversations c
    WHERE c.id = v_sale.conversation_id
    LIMIT 1;
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
  RETURNING public.offline_conversion_queue.id INTO v_queue_id;

  RETURN QUERY SELECT p_sale_id, 'CONFIRMED'::text, (v_queue_id IS NOT NULL);
END;
$$;

COMMENT ON FUNCTION public.confirm_sale_and_enqueue(uuid) IS
  'Confirm sale and enqueue OCI row. Enforces tenant access via can_access_site when called as authenticated.';

-- -----------------------------------------------------------------------------
-- 3) update_offline_conversion_queue_attribution — tenant check + lock queue row
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

  SELECT c.primary_source INTO v_primary_source
  FROM public.conversations c
  WHERE c.id = v_sale.conversation_id
  LIMIT 1;
  IF v_primary_source IS NULL THEN
    RETURN;
  END IF;

  -- Lock and update queue row; restrict by site_id so update is scoped to this sale's queue row
  UPDATE public.offline_conversion_queue q
  SET
    gclid = COALESCE(v_primary_source->>'gclid', q.gclid),
    wbraid = COALESCE(v_primary_source->>'wbraid', q.wbraid),
    gbraid = COALESCE(v_primary_source->>'gbraid', q.gbraid),
    updated_at = now()
  WHERE q.sale_id = p_sale_id
    AND q.site_id = v_sale.site_id;
END;
$$;

COMMENT ON FUNCTION public.update_offline_conversion_queue_attribution(uuid) IS
  'P1 Late linking: backfill gclid/wbraid/gbraid from conversation. Enforces tenant access; locks sale then updates queue by sale_id+site_id.';

-- -----------------------------------------------------------------------------
-- 4) claim_offline_conversion_jobs — service_role only, explicit ORDER BY
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_offline_conversion_jobs(p_limit int)
RETURNS SETOF public.offline_conversion_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int;
BEGIN
  -- Only service_role (no user context) may claim jobs; prevents tenant exposure if grant is widened
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'claim_offline_conversion_jobs may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 10), 500));

  RETURN QUERY
  UPDATE public.offline_conversion_queue q
  SET status = 'PROCESSING', updated_at = now()
  FROM (
    SELECT oq.id
    FROM public.offline_conversion_queue oq
    WHERE oq.status = 'QUEUED'
    ORDER BY oq.created_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ) sub
  WHERE q.id = sub.id
  RETURNING q.*;
END;
$$;

COMMENT ON FUNCTION public.claim_offline_conversion_jobs(int) IS
  'Claim up to p_limit QUEUED jobs for processing. Service_role only. Concurrency-safe via FOR UPDATE SKIP LOCKED; ORDER BY created_at ASC.';

COMMIT;
