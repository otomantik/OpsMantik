BEGIN;

CREATE TABLE IF NOT EXISTS public.total_routing_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites (id) ON DELETE CASCADE,
  lane text NOT NULL,
  unit_id text NOT NULL,
  from_state text NOT NULL,
  to_state text NOT NULL,
  reason_code text NOT NULL,
  actor text NOT NULL DEFAULT 'system',
  trace_id text,
  correlation_id text,
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT total_routing_unique_hop UNIQUE (site_id, lane, unit_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS total_routing_lookup_idx
  ON public.total_routing_ledger (site_id, lane, unit_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.append_total_routing_hop_v1(
  p_site_id uuid,
  p_lane text,
  p_unit_id text,
  p_from_state text,
  p_to_state text,
  p_reason_code text,
  p_actor text,
  p_trace_id text,
  p_correlation_id text,
  p_idempotency_key text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.total_routing_ledger (
    site_id,
    lane,
    unit_id,
    from_state,
    to_state,
    reason_code,
    actor,
    trace_id,
    correlation_id,
    idempotency_key
  )
  VALUES (
    p_site_id,
    p_lane,
    p_unit_id,
    p_from_state,
    p_to_state,
    p_reason_code,
    COALESCE(NULLIF(p_actor, ''), 'system'),
    NULLIF(p_trace_id, ''),
    NULLIF(p_correlation_id, ''),
    p_idempotency_key
  )
  ON CONFLICT (site_id, lane, unit_id, idempotency_key) DO NOTHING;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE VIEW public.orphaned_routing_units_v1 AS
SELECT
  site_id,
  lane,
  unit_id,
  max(created_at) AS last_seen_at
FROM public.total_routing_ledger
GROUP BY site_id, lane, unit_id
HAVING bool_or(to_state = 'UNKNOWN_OWNER') = TRUE;

REVOKE ALL ON TABLE public.total_routing_ledger FROM PUBLIC;
GRANT ALL ON TABLE public.total_routing_ledger TO service_role;

COMMIT;
