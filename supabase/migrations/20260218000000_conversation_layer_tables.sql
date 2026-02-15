-- =============================================================================
-- Conversation Layer C1: tables, RLS, RPCs (claim_offline_conversion_jobs, confirm_sale_and_enqueue)
-- P0/P1: atomic confirm via RPC; queue RLS admin-only SELECT; entity_type session|call|event; bigint cents.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) conversations
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','WON','LOST','JUNK')),
  primary_intent_id uuid,
  primary_session_id uuid,
  primary_call_id uuid,
  primary_source jsonb,
  note text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_site_primary_call
  ON public.conversations(site_id, primary_call_id) WHERE primary_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_site_status ON public.conversations(site_id, status);

-- -----------------------------------------------------------------------------
-- 2) conversation_links (entity_type: session | call | event only this sprint)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversation_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('session','call','event')),
  entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_links_conversation_id ON public.conversation_links(conversation_id);

-- -----------------------------------------------------------------------------
-- 3) sales (amount_cents bigint)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'TRY',
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CONFIRMED','CANCELED')),
  external_ref text,
  customer_hash text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_site_external_ref
  ON public.sales(site_id, external_ref) WHERE external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_site_occurred_at ON public.sales(site_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_site_status ON public.sales(site_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_conversation_id ON public.sales(conversation_id);

-- -----------------------------------------------------------------------------
-- 4) offline_conversion_queue (value_cents bigint; one row per sale)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offline_conversion_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'google_ads',
  action text NOT NULL DEFAULT 'purchase',
  gclid text,
  wbraid text,
  gbraid text,
  conversion_time timestamptz NOT NULL,
  value_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'TRY',
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PROCESSING','COMPLETED','FAILED')),
  attempt_count int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offline_conversion_queue_sale_id_key UNIQUE (sale_id)
);

CREATE INDEX IF NOT EXISTS idx_offline_conversion_queue_status_created_at
  ON public.offline_conversion_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_offline_conversion_queue_site_id ON public.offline_conversion_queue(site_id);

-- -----------------------------------------------------------------------------
-- 5) updated_at triggers (reuse set_updated_at from Revenue Kernel)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS conversations_set_updated_at ON public.conversations;
CREATE TRIGGER conversations_set_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS sales_set_updated_at ON public.sales;
CREATE TRIGGER sales_set_updated_at
  BEFORE UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS offline_conversion_queue_set_updated_at ON public.offline_conversion_queue;
CREATE TRIGGER offline_conversion_queue_set_updated_at
  BEFORE UPDATE ON public.offline_conversion_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6) RLS: conversations
-- -----------------------------------------------------------------------------
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversations_site_members" ON public.conversations;
CREATE POLICY "conversations_site_members"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.conversations.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid())
             OR public.is_admin(auth.uid()))
    )
  );

CREATE POLICY "conversations_site_members_insert"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.conversations.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid())
             OR public.is_admin(auth.uid()))
    )
  );

CREATE POLICY "conversations_site_members_update"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.conversations.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid())
             OR public.is_admin(auth.uid()))
    )
  );

-- -----------------------------------------------------------------------------
-- 7) RLS: conversation_links
-- -----------------------------------------------------------------------------
ALTER TABLE public.conversation_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversation_links_via_conversation" ON public.conversation_links;
CREATE POLICY "conversation_links_via_conversation"
  ON public.conversation_links FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.sites s ON s.id = c.site_id
      WHERE c.id = public.conversation_links.conversation_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid())
             OR public.is_admin(auth.uid()))
    )
  );

CREATE POLICY "conversation_links_via_conversation_insert"
  ON public.conversation_links FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.sites s ON s.id = c.site_id
      WHERE c.id = public.conversation_links.conversation_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid())
             OR public.is_admin(auth.uid()))
    )
  );

-- -----------------------------------------------------------------------------
-- 8) RLS: sales
-- -----------------------------------------------------------------------------
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_site_members" ON public.sales;
CREATE POLICY "sales_site_members"
  ON public.sales FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.sales.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid())
             OR public.is_admin(auth.uid()))
    )
  );

CREATE POLICY "sales_site_members_insert"
  ON public.sales FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.sales.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid())
             OR public.is_admin(auth.uid()))
    )
  );

CREATE POLICY "sales_site_members_update"
  ON public.sales FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.sales.site_id
        AND (s.user_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = auth.uid())
             OR public.is_admin(auth.uid()))
    )
  );

-- -----------------------------------------------------------------------------
-- 9) RLS: offline_conversion_queue — SELECT admin only; INSERT/UPDATE/DELETE service_role only
-- -----------------------------------------------------------------------------
ALTER TABLE public.offline_conversion_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "offline_conversion_queue_select_admin" ON public.offline_conversion_queue;
CREATE POLICY "offline_conversion_queue_select_admin"
  ON public.offline_conversion_queue FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- No INSERT/UPDATE/DELETE policy for authenticated; only service_role can write.

-- -----------------------------------------------------------------------------
-- 10) Grants
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversation_links TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sales TO authenticated;

GRANT SELECT ON public.offline_conversion_queue TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.offline_conversion_queue TO service_role;

GRANT ALL ON public.conversations TO service_role;
GRANT ALL ON public.conversation_links TO service_role;
GRANT ALL ON public.sales TO service_role;
GRANT ALL ON public.offline_conversion_queue TO service_role;

-- -----------------------------------------------------------------------------
-- 11) RPC: claim_offline_conversion_jobs(p_limit int)
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
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 10), 500));

  RETURN QUERY
  UPDATE public.offline_conversion_queue q
  SET status = 'PROCESSING', updated_at = now()
  FROM (
    SELECT id FROM public.offline_conversion_queue
    WHERE status = 'QUEUED'
    ORDER BY created_at
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ) sub
  WHERE q.id = sub.id
  RETURNING q.*;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_offline_conversion_jobs(int) TO service_role;

-- -----------------------------------------------------------------------------
-- 12) RPC: confirm_sale_and_enqueue(p_sale_id uuid)
-- Returns (sale_id uuid, new_status text, enqueued boolean).
-- Raises: sale_not_found -> 404; sale_already_confirmed_or_canceled -> 409.
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

GRANT EXECUTE ON FUNCTION public.confirm_sale_and_enqueue(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_sale_and_enqueue(uuid) TO service_role;

COMMIT;
