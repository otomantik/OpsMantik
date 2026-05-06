-- Stage 1: The Bone (Iron Protocol v3)
-- 1. Lifecycle Statuses & Transition Matrix
-- 2. apply_lifecycle_mutation_v3 RPC
-- 3. Revoke legacy grants

BEGIN;

-- ── 1. Tables ──

CREATE TABLE IF NOT EXISTS public.lifecycle_statuses (
  status text PRIMARY KEY,
  description text,
  is_terminal boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lifecycle_transitions (
  from_status text REFERENCES public.lifecycle_statuses(status),
  to_status text REFERENCES public.lifecycle_statuses(status),
  requires_audit boolean DEFAULT false,
  role_required text DEFAULT 'operator', -- operator, admin, service_role
  PRIMARY KEY (from_status, to_status)
);

-- ── 2. Seed Data ──

INSERT INTO public.lifecycle_statuses (status, description, is_terminal) VALUES
  ('intent', 'Initial interest captured from session', false),
  ('contacted', 'Lead has been contacted by operator', false),
  ('offered', 'Proposal or offer has been sent', false),
  ('won', 'Deal closed successfully', true),
  ('junk', 'Spam, bot, or invalid lead', true),
  ('cancelled', 'Lead dropped out or cancelled', true)
ON CONFLICT (status) DO UPDATE SET 
  description = EXCLUDED.description,
  is_terminal = EXCLUDED.is_terminal;

INSERT INTO public.lifecycle_transitions (from_status, to_status, requires_audit) VALUES
  ('intent', 'contacted', false),
  ('intent', 'offered', false),
  ('intent', 'won', false),
  ('intent', 'junk', false),
  ('intent', 'cancelled', false),
  ('contacted', 'offered', false),
  ('contacted', 'won', false),
  ('contacted', 'junk', false),
  ('contacted', 'cancelled', false),
  ('offered', 'won', false),
  ('offered', 'junk', false),
  ('offered', 'cancelled', false),
  ('won', 'junk', true),
  ('won', 'cancelled', true),
  ('junk', 'intent', true),
  ('cancelled', 'intent', true)
ON CONFLICT DO NOTHING;

-- ── 3. The Iron FSM RPC ──

CREATE OR REPLACE FUNCTION public.apply_lifecycle_mutation_v3(
  p_call_id uuid,
  p_site_id uuid,
  p_target_status text,
  p_actor_id uuid,
  p_lead_score integer DEFAULT NULL,
  p_version integer DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_sale_metadata jsonb DEFAULT NULL
)
RETURNS public.calls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.calls;
  v_current_status text;
  v_transition_allowed boolean;
BEGIN
  -- 1. Identity & Locking
  SELECT * INTO v_row
  FROM public.calls
  WHERE id = p_call_id AND site_id = p_site_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'call_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Version Conflict (Optimistic Locking)
  IF p_version IS NOT NULL AND coalesce(v_row.version, 0) <> p_version THEN
    RAISE EXCEPTION 'version_conflict' USING 
      DETAIL = format('Expected %s, found %s', p_version, coalesce(v_row.version, 0)),
      ERRCODE = '40900';
  END IF;

  v_current_status := coalesce(v_row.status, 'intent');

  -- 3. Transition Validation
  IF v_current_status = p_target_status THEN
    RETURN v_row; -- No-op
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.lifecycle_transitions
    WHERE from_status = v_current_status AND to_status = p_target_status
  ) INTO v_transition_allowed;

  IF NOT v_transition_allowed THEN
    RAISE EXCEPTION 'illegal_transition' USING 
      DETAIL = format('Transition from %s to %s is not allowed.', v_current_status, p_target_status),
      ERRCODE = 'P0001';
  END IF;

  -- 4. Execute Mutation
  UPDATE public.calls
  SET
    status = p_target_status,
    lead_score = coalesce(p_lead_score, lead_score),
    version = coalesce(version, 0) + 1,
    reviewed_at = timezone('utc', now()),
    reviewed_by = p_actor_id,
    confirmed_at = CASE 
      WHEN p_target_status = 'won' THEN timezone('utc', now())
      ELSE confirmed_at 
    END,
    confirmed_by = CASE 
      WHEN p_target_status = 'won' THEN p_actor_id
      ELSE confirmed_by
    END,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'last_mutation', jsonb_build_object(
        'from', v_current_status,
        'to', p_target_status,
        'actor', p_actor_id,
        'timestamp', now()
      )
    ) || coalesce(p_metadata, '{}'::jsonb)
  WHERE id = p_call_id AND site_id = p_site_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ── 4. Grants ──

REVOKE ALL ON TABLE public.lifecycle_statuses FROM PUBLIC;
REVOKE ALL ON TABLE public.lifecycle_transitions FROM PUBLIC;
GRANT SELECT ON TABLE public.lifecycle_statuses TO authenticated, service_role;
GRANT SELECT ON TABLE public.lifecycle_transitions TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.apply_lifecycle_mutation_v3 TO service_role;
-- Note: authenticated is intentionally excluded from direct execution to enforce server-side proxying.

COMMIT;
