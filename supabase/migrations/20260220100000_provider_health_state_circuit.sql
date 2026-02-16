-- PR5: Provider health state + circuit breaker (CLOSED / OPEN / HALF_OPEN). Site-scoped; service_role only.

BEGIN;

DO $$ BEGIN
  CREATE TYPE public.provider_circuit_state AS ENUM ('CLOSED', 'OPEN', 'HALF_OPEN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.provider_health_state (
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  provider_key text NOT NULL,
  state public.provider_circuit_state NOT NULL DEFAULT 'CLOSED',
  failure_count int NOT NULL DEFAULT 0,
  last_failure_at timestamptz,
  opened_at timestamptz,
  next_probe_at timestamptz,
  probe_limit int NOT NULL DEFAULT 5,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, provider_key)
);

COMMENT ON TABLE public.provider_health_state IS
  'PR5: Circuit breaker state per (site_id, provider_key). service_role only.';

CREATE INDEX IF NOT EXISTS idx_provider_health_state_next_probe
  ON public.provider_health_state (next_probe_at) WHERE state = 'OPEN';

ALTER TABLE public.provider_health_state ENABLE ROW LEVEL SECURITY;

-- No policies: service_role only via SECURITY DEFINER RPCs.

CREATE OR REPLACE FUNCTION public.get_provider_health_state(p_site_id uuid, p_provider_key text)
RETURNS TABLE (
  site_id uuid,
  provider_key text,
  state public.provider_circuit_state,
  failure_count int,
  last_failure_at timestamptz,
  opened_at timestamptz,
  next_probe_at timestamptz,
  probe_limit int,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'get_provider_health_state may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.provider_health_state (site_id, provider_key)
  VALUES (p_site_id, p_provider_key)
  ON CONFLICT (site_id, provider_key) DO NOTHING;

  RETURN QUERY
  SELECT h.site_id, h.provider_key, h.state, h.failure_count, h.last_failure_at, h.opened_at, h.next_probe_at, h.probe_limit, h.updated_at
  FROM public.provider_health_state h
  WHERE h.site_id = p_site_id AND h.provider_key = p_provider_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_provider_state_half_open(p_site_id uuid, p_provider_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'set_provider_state_half_open may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  UPDATE public.provider_health_state
  SET state = 'HALF_OPEN', updated_at = now()
  WHERE site_id = p_site_id AND provider_key = p_provider_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_provider_outcome(
  p_site_id uuid,
  p_provider_key text,
  p_is_success boolean,
  p_is_transient boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold int := 5;
  v_next_probe timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'record_provider_outcome may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.provider_health_state (site_id, provider_key)
  VALUES (p_site_id, p_provider_key)
  ON CONFLICT (site_id, provider_key) DO NOTHING;

  IF p_is_success THEN
    UPDATE public.provider_health_state
    SET state = 'CLOSED', failure_count = 0, last_failure_at = NULL, opened_at = NULL, next_probe_at = NULL, updated_at = now()
    WHERE site_id = p_site_id AND provider_key = p_provider_key;
    RETURN;
  END IF;

  IF p_is_transient THEN
    UPDATE public.provider_health_state
    SET failure_count = failure_count + 1, last_failure_at = now(), updated_at = now()
    WHERE site_id = p_site_id AND provider_key = p_provider_key;

    UPDATE public.provider_health_state
    SET state = 'OPEN', opened_at = now(),
        next_probe_at = now() + interval '5 minutes' + (random() * interval '60 seconds')
    WHERE site_id = p_site_id AND provider_key = p_provider_key
      AND failure_count >= v_threshold;
    RETURN;
  END IF;

  -- Permanent failure: do not increment failure_count, do not open circuit.
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.get_provider_health_state(uuid, text) IS 'PR5: Get or upsert health row. service_role only.';
COMMENT ON FUNCTION public.set_provider_state_half_open(uuid, text) IS 'PR5: Set state to HALF_OPEN for probe. service_role only.';
COMMENT ON FUNCTION public.record_provider_outcome(uuid, text, boolean, boolean) IS 'PR5: Record success (reset) or transient (increment, open at 5). service_role only.';

GRANT EXECUTE ON FUNCTION public.get_provider_health_state(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_provider_state_half_open(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_provider_outcome(uuid, text, boolean, boolean) TO service_role;

COMMIT;
