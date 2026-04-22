BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (timezone = 'UTC' OR timezone ~ '^[A-Za-z]+/[A-Za-z0-9_+-]+$')
);

CREATE TABLE public.site_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'operator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, site_id)
);

CREATE TABLE public.ingest_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  canonical_action text NOT NULL,
  canonical_target text NOT NULL,
  request_hash text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  replay_count integer NOT NULL DEFAULT 0,
  UNIQUE (site_id, idempotency_key)
);

CREATE TABLE public.raw_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  canonical_action text NOT NULL,
  canonical_target text NOT NULL,
  payload jsonb NOT NULL,
  event_time timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (canonical_action IN ('call', 'form', 'click', 'junk')),
  CHECK (canonical_target IN ('phone', 'whatsapp', 'form_submit', 'landing', 'unknown', 'junk')),
  UNIQUE (site_id, idempotency_key)
);

CREATE TABLE public.identity_stitch_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  signal_id uuid NOT NULL REFERENCES public.raw_signals(id) ON DELETE CASCADE,
  click_id text NULL,
  click_id_kind text NULL CHECK (click_id_kind IN ('gclid', 'wbraid', 'gbraid')),
  phone_hash text NULL,
  stitch_method text NOT NULL CHECK (stitch_method IN ('direct', 'phone_hash', 'fingerprint')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, signal_id)
);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  current_stage text NOT NULL DEFAULT 'junk' CHECK (current_stage IN ('junk', 'contacted', 'offered', 'won')),
  version integer NOT NULL DEFAULT 1,
  won_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.lead_stage_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  from_stage text NOT NULL CHECK (from_stage IN ('junk', 'contacted', 'offered', 'won')),
  to_stage text NOT NULL CHECK (to_stage IN ('junk', 'contacted', 'offered', 'won')),
  actor text NOT NULL,
  causation_id text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION public.fsm_stage_rank(p_stage text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_stage
    WHEN 'junk' THEN 0
    WHEN 'contacted' THEN 1
    WHEN 'offered' THEN 2
    WHEN 'won' THEN 3
    ELSE -1
  END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_lead_fsm_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.current_stage IS DISTINCT FROM OLD.current_stage THEN
    IF public.fsm_stage_rank(NEW.current_stage) < public.fsm_stage_rank(OLD.current_stage) THEN
      RAISE EXCEPTION 'fsm_regression_denied: % -> %', OLD.current_stage, NEW.current_stage USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.lead_stage_ledger(site_id, lead_id, from_stage, to_stage, actor, causation_id, metadata)
    VALUES (NEW.site_id, NEW.id, OLD.current_stage, NEW.current_stage, 'system', NULL, '{}'::jsonb);
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_lead_fsm_transition
BEFORE UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.enforce_lead_fsm_transition();

CREATE TABLE public.conversion_dispatch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('google_ads')),
  provider_action text NOT NULL DEFAULT 'won',
  click_id text NOT NULL,
  click_id_kind text NOT NULL CHECK (click_id_kind IN ('gclid', 'wbraid', 'gbraid')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'RETRY', 'SENT', 'FAILED', 'DEAD_LETTER')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz NULL,
  claimed_by text NULL,
  provider_request_id text NULL,
  provider_response jsonb NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, idempotency_key),
  UNIQUE (site_id, lead_id)
);

CREATE TABLE public.conversion_dispatch_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES public.conversion_dispatch(id) ON DELETE CASCADE,
  from_status text NOT NULL,
  to_status text NOT NULL,
  actor text NOT NULL,
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.enforce_conversion_dispatch_state_machine()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'PENDING' AND NEW.status IN ('PROCESSING', 'FAILED', 'DEAD_LETTER')) OR
      (OLD.status = 'PROCESSING' AND NEW.status IN ('RETRY', 'SENT', 'FAILED', 'DEAD_LETTER')) OR
      (OLD.status = 'RETRY' AND NEW.status IN ('PROCESSING', 'FAILED', 'DEAD_LETTER')) OR
      (OLD.status = 'SENT' AND NEW.status = 'SENT') OR
      (OLD.status = 'FAILED' AND NEW.status = 'FAILED') OR
      (OLD.status = 'DEAD_LETTER' AND NEW.status = 'DEAD_LETTER')
    ) THEN
      RAISE EXCEPTION 'dispatch_transition_denied: % -> %', OLD.status, NEW.status USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.conversion_dispatch_transitions(dispatch_id, from_status, to_status, actor, reason)
    VALUES (NEW.id, OLD.status, NEW.status, 'system', NULL);
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_conversion_dispatch_state_machine
BEFORE UPDATE ON public.conversion_dispatch
FOR EACH ROW EXECUTE FUNCTION public.enforce_conversion_dispatch_state_machine();

CREATE OR REPLACE FUNCTION public.claim_conversion_dispatch_batch(p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid, site_id uuid, lead_id uuid, click_id text, click_id_kind text, attempt_count integer, provider text, provider_action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH locked AS (
    SELECT d.id
    FROM public.conversion_dispatch d
    WHERE d.status IN ('PENDING', 'RETRY') AND d.next_retry_at <= now()
    ORDER BY d.created_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 500))
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.conversion_dispatch d
       SET status = 'PROCESSING',
           attempt_count = d.attempt_count + 1,
           claimed_at = now(),
           claimed_by = current_setting('request.jwt.claim.sub', true),
           updated_at = now()
      FROM locked l
     WHERE d.id = l.id
    RETURNING d.id, d.site_id, d.lead_id, d.click_id, d.click_id_kind, d.attempt_count, d.provider, d.provider_action
  )
  SELECT * FROM upd;
END;
$$;

CREATE TABLE public.ack_receipt_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  payload_hash text NOT NULL,
  apply_state text NOT NULL DEFAULT 'REGISTERED' CHECK (apply_state IN ('REGISTERED', 'APPLIED')),
  result_snapshot jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, request_key)
);

CREATE OR REPLACE FUNCTION public.register_ack_receipt_v1(
  p_site_id uuid,
  p_request_key text,
  p_payload_hash text
)
RETURNS TABLE(receipt_id uuid, replayed boolean, in_progress boolean, result_snapshot jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.ack_receipt_ledger(site_id, request_key, payload_hash)
  VALUES (p_site_id, p_request_key, p_payload_hash)
  ON CONFLICT (site_id, request_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, false, false, NULL::jsonb;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ack_receipt_ledger r
    WHERE r.site_id = p_site_id
      AND r.request_key = p_request_key
      AND r.payload_hash <> p_payload_hash
  ) THEN
    RAISE EXCEPTION 'ACK_PAYLOAD_HASH_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT id, true, (apply_state = 'REGISTERED') AS in_progress, result_snapshot
  FROM public.ack_receipt_ledger
  WHERE site_id = p_site_id AND request_key = p_request_key
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_ack_receipt_v1(
  p_receipt_id uuid,
  p_result_snapshot jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_updated integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.ack_receipt_ledger
  SET apply_state = 'APPLIED',
      result_snapshot = p_result_snapshot,
      updated_at = now()
  WHERE id = p_receipt_id
    AND apply_state = 'REGISTERED';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_stitch_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_stage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversion_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversion_dispatch_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ack_receipt_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY sites_membership_read ON public.sites
FOR SELECT USING (EXISTS (SELECT 1 FROM public.site_memberships m WHERE m.site_id = sites.id AND m.user_id = auth.uid()));

CREATE POLICY site_memberships_self_read ON public.site_memberships
FOR SELECT USING (site_memberships.user_id = auth.uid());

CREATE POLICY ingest_idempotency_service_role_only ON public.ingest_idempotency
FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY raw_signals_service_role_only ON public.raw_signals
FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY identity_stitch_service_role_only ON public.identity_stitch_links
FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY leads_site_membership_read ON public.leads
FOR SELECT USING (EXISTS (SELECT 1 FROM public.site_memberships m WHERE m.site_id = leads.site_id AND m.user_id = auth.uid()));

CREATE POLICY leads_service_role_write ON public.leads
FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY lead_stage_ledger_read ON public.lead_stage_ledger
FOR SELECT USING (EXISTS (SELECT 1 FROM public.site_memberships m WHERE m.site_id = lead_stage_ledger.site_id AND m.user_id = auth.uid()));

CREATE POLICY lead_stage_ledger_service_write ON public.lead_stage_ledger
FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY conversion_dispatch_service_role_only ON public.conversion_dispatch
FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY conversion_dispatch_tenant_read ON public.conversion_dispatch
FOR SELECT USING (EXISTS (SELECT 1 FROM public.site_memberships m WHERE m.site_id = conversion_dispatch.site_id AND m.user_id = auth.uid()));

CREATE POLICY conversion_dispatch_transitions_service_role_only ON public.conversion_dispatch_transitions
FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY conversion_dispatch_transitions_tenant_read ON public.conversion_dispatch_transitions
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.conversion_dispatch d
    JOIN public.site_memberships m ON m.site_id = d.site_id
    WHERE d.id = conversion_dispatch_transitions.dispatch_id
      AND m.user_id = auth.uid()
  )
);

CREATE POLICY ack_receipt_ledger_service_role_only ON public.ack_receipt_ledger
FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

GRANT EXECUTE ON FUNCTION public.claim_conversion_dispatch_batch(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_ack_receipt_v1(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_ack_receipt_v1(uuid, jsonb) TO service_role;

COMMIT;
