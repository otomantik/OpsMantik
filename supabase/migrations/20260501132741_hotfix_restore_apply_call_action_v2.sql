BEGIN;

CREATE OR REPLACE FUNCTION public.apply_call_action_v2(
  p_call_id uuid,
  p_site_id uuid,
  p_stage text,
  p_actor_id uuid,
  p_lead_score integer DEFAULT NULL,
  p_version integer DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.calls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.calls;
  v_target_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  IF p_call_id IS NULL OR p_site_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_params', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row
  FROM public.calls c
  WHERE c.id = p_call_id
    AND c.site_id = p_site_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'call_not_found', ERRCODE = 'P0001';
  END IF;

  IF p_version IS NOT NULL AND coalesce(v_row.version, 0) <> p_version THEN
    RAISE EXCEPTION USING MESSAGE = 'version_conflict', ERRCODE = '40900';
  END IF;

  v_target_status := lower(coalesce(nullif(trim(p_stage), ''), 'intent'));
  IF v_target_status NOT IN ('intent', 'contacted', 'offered', 'won', 'confirmed', 'junk', 'cancelled') THEN
    v_target_status := 'intent';
  END IF;

  UPDATE public.calls c
  SET
    status = v_target_status,
    lead_score = coalesce(p_lead_score, c.lead_score),
    version = coalesce(c.version, 0) + 1
  WHERE c.id = p_call_id
    AND c.site_id = p_site_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_call_action_v2(uuid, uuid, text, uuid, integer, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_call_action_v2(uuid, uuid, text, uuid, integer, integer, jsonb) TO service_role;

COMMIT;

