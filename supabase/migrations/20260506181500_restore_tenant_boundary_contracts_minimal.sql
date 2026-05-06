-- Restore minimal tenant-boundary contracts required by integration guards.
-- Additive and compatibility-focused: does not alter OCI math or queue semantics.

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS session_created_month date;

UPDATE public.calls
SET session_created_month = date_trunc('month', COALESCE(matched_at, created_at))::date
WHERE session_created_month IS NULL;

ALTER TABLE public.calls
  ALTER COLUMN session_created_month SET DEFAULT date_trunc('month', now())::date;

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'OPEN',
  primary_call_id uuid NULL REFERENCES public.calls(id) ON DELETE SET NULL,
  primary_session_id uuid NULL,
  primary_source jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_site_id ON public.conversations(site_id);
CREATE INDEX IF NOT EXISTS idx_conversations_primary_call_id ON public.conversations(primary_call_id);
CREATE INDEX IF NOT EXISTS idx_conversations_primary_session_id ON public.conversations(primary_session_id);

CREATE TABLE IF NOT EXISTS public.conversation_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('session', 'call', 'event')),
  entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_links_conversation_id ON public.conversation_links(conversation_id);

CREATE TABLE IF NOT EXISTS public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  conversation_id uuid NULL REFERENCES public.conversations(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL,
  amount_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'TRY',
  status text NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_site_id ON public.sales(site_id);
CREATE INDEX IF NOT EXISTS idx_sales_conversation_id ON public.sales(conversation_id);

CREATE OR REPLACE FUNCTION public.conversation_links_entity_site_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_conversation_site_id uuid;
  v_entity_site_id uuid;
BEGIN
  SELECT c.site_id
  INTO v_conversation_site_id
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id;

  IF v_conversation_site_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'conversation_links: conversation not found', ERRCODE = 'P0001';
  END IF;

  IF NEW.entity_type = 'call' THEN
    SELECT c.site_id INTO v_entity_site_id FROM public.calls c WHERE c.id = NEW.entity_id;
  ELSIF NEW.entity_type = 'session' THEN
    SELECT s.site_id INTO v_entity_site_id FROM public.sessions s WHERE s.id = NEW.entity_id;
  ELSIF NEW.entity_type = 'event' THEN
    SELECT e.site_id INTO v_entity_site_id FROM public.events e WHERE e.id = NEW.entity_id;
  ELSE
    RAISE EXCEPTION USING MESSAGE = 'conversation_links: invalid entity_type', ERRCODE = 'P0001';
  END IF;

  IF v_entity_site_id IS NULL OR v_entity_site_id <> v_conversation_site_id THEN
    RAISE EXCEPTION USING MESSAGE = 'conversation_links: entity must belong to the same site as the conversation', ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversation_links_entity_site_trigger ON public.conversation_links;
CREATE TRIGGER conversation_links_entity_site_trigger
BEFORE INSERT OR UPDATE OF conversation_id, entity_type, entity_id
ON public.conversation_links
FOR EACH ROW
EXECUTE FUNCTION public.conversation_links_entity_site_check();

CREATE OR REPLACE FUNCTION public.sales_conversation_site_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_conversation_site_id uuid;
BEGIN
  IF NEW.conversation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.site_id INTO v_conversation_site_id
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id;

  IF v_conversation_site_id IS NULL OR v_conversation_site_id <> NEW.site_id THEN
    RAISE EXCEPTION USING MESSAGE = 'sales: conversation_id must belong to the same site as the sale', ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_conversation_site_trigger ON public.sales;
CREATE TRIGGER sales_conversation_site_trigger
BEFORE INSERT OR UPDATE OF site_id, conversation_id
ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.sales_conversation_site_check();

CREATE OR REPLACE FUNCTION public.create_conversation_with_primary_entity(
  p_site_id uuid,
  p_primary_entity_type text,
  p_primary_entity_id uuid,
  p_primary_source jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_primary_site_id uuid;
  v_conversation_id uuid;
BEGIN
  IF p_primary_entity_type = 'call' THEN
    SELECT c.site_id INTO v_primary_site_id FROM public.calls c WHERE c.id = p_primary_entity_id;
  ELSIF p_primary_entity_type = 'session' THEN
    SELECT s.site_id INTO v_primary_site_id FROM public.sessions s WHERE s.id = p_primary_entity_id;
  ELSIF p_primary_entity_type = 'event' THEN
    SELECT e.site_id INTO v_primary_site_id FROM public.events e WHERE e.id = p_primary_entity_id;
  ELSE
    RAISE EXCEPTION USING MESSAGE = 'invalid_primary_entity_type', ERRCODE = 'P0001';
  END IF;

  IF v_primary_site_id IS NULL OR v_primary_site_id <> p_site_id THEN
    RAISE EXCEPTION USING MESSAGE = 'primary_entity_site_mismatch', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.conversations (
    site_id,
    status,
    primary_call_id,
    primary_session_id,
    primary_source
  )
  VALUES (
    p_site_id,
    'OPEN',
    CASE WHEN p_primary_entity_type = 'call' THEN p_primary_entity_id ELSE NULL END,
    CASE WHEN p_primary_entity_type = 'session' THEN p_primary_entity_id ELSE NULL END,
    p_primary_source
  )
  RETURNING id INTO v_conversation_id;

  INSERT INTO public.conversation_links (conversation_id, entity_type, entity_id)
  VALUES (v_conversation_id, p_primary_entity_type, p_primary_entity_id);

  RETURN jsonb_build_object(
    'id', v_conversation_id,
    'site_id', p_site_id,
    'primary_entity_type', p_primary_entity_type,
    'primary_entity_id', p_primary_entity_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_conversation_with_primary_entity(uuid, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_conversation_with_primary_entity(uuid, text, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_conversation_with_primary_entity(uuid, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_conversation_with_primary_entity(uuid, text, uuid, jsonb) TO service_role;
