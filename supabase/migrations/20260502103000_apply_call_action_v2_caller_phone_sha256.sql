-- Panel stage + operator phone: persist to caller_phone_* columns (SHA256 column name),
-- grant trigger bypass, route all phone writes through 11-param apply_call_action_v2.

BEGIN;

DROP FUNCTION IF EXISTS public.apply_call_action_with_review_v1(uuid, uuid, text, uuid, integer, integer, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.apply_call_action_v2(
  p_call_id uuid,
  p_site_id uuid,
  p_stage text,
  p_actor_id uuid,
  p_lead_score integer DEFAULT NULL,
  p_sale_metadata jsonb DEFAULT NULL,
  p_version integer DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_caller_phone_raw text DEFAULT NULL,
  p_caller_phone_e164 text DEFAULT NULL,
  p_caller_phone_hash text DEFAULT NULL
)
RETURNS public.calls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.calls;
  v_target_status text;
  v_merged_metadata jsonb;
  v_phone_incoming boolean;
BEGIN
  IF p_call_id IS NULL OR p_site_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_params', ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_row
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

  v_merged_metadata :=
    coalesce(v_row.metadata, '{}'::jsonb)
    || coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'stage', v_target_status,
      'actor_id', p_actor_id,
      'sale_metadata', coalesce(p_sale_metadata, '{}'::jsonb)
    );

  UPDATE public.calls c
  SET
    status = v_target_status,
    lead_score = coalesce(p_lead_score, c.lead_score),
    confirmed_at = CASE
      WHEN v_target_status IN ('won', 'confirmed') THEN coalesce(c.confirmed_at, timezone('utc', now()))
      WHEN v_target_status IN ('intent', 'junk', 'cancelled', 'contacted', 'offered') THEN NULL
      ELSE c.confirmed_at
    END,
    confirmed_by = CASE
      WHEN v_target_status IN ('won', 'confirmed') THEN coalesce(p_actor_id, c.confirmed_by)
      WHEN v_target_status IN ('intent', 'junk', 'cancelled', 'contacted', 'offered') THEN NULL
      ELSE c.confirmed_by
    END,
    metadata = v_merged_metadata,
    version = coalesce(c.version, 0) + 1
  WHERE c.id = p_call_id
    AND c.site_id = p_site_id
  RETURNING * INTO v_row;

  v_phone_incoming :=
    nullif(btrim(p_caller_phone_raw), '') IS NOT NULL
    OR nullif(btrim(p_caller_phone_e164), '') IS NOT NULL
    OR nullif(btrim(p_caller_phone_hash), '') IS NOT NULL;

  IF v_phone_incoming THEN
    PERFORM set_config('app.allow_caller_phone', '1', true);

    UPDATE public.calls c
    SET
      caller_phone_raw = coalesce(nullif(btrim(p_caller_phone_raw), ''), c.caller_phone_raw),
      caller_phone_e164 = coalesce(nullif(btrim(p_caller_phone_e164), ''), c.caller_phone_e164),
      caller_phone_hash_sha256 = coalesce(nullif(btrim(p_caller_phone_hash), ''), c.caller_phone_hash_sha256),
      phone_source_type = 'operator_verified'
    WHERE c.id = p_call_id
      AND c.site_id = p_site_id
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

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
BEGIN
  SELECT *
  INTO v_row
  FROM public.apply_call_action_v2(
    p_call_id => p_call_id,
    p_site_id => p_site_id,
    p_stage => p_stage,
    p_actor_id => p_actor_id,
    p_lead_score => p_lead_score,
    p_sale_metadata => '{}'::jsonb,
    p_version => p_version,
    p_metadata => p_metadata,
    p_caller_phone_raw => NULL,
    p_caller_phone_e164 => NULL,
    p_caller_phone_hash => NULL
  );
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_call_action_with_review_v1(
  p_call_id uuid,
  p_site_id uuid,
  p_stage text,
  p_actor_id uuid,
  p_lead_score integer DEFAULT NULL,
  p_version integer DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_reviewed boolean DEFAULT true,
  p_caller_phone_raw text DEFAULT NULL,
  p_caller_phone_e164 text DEFAULT NULL,
  p_caller_phone_hash text DEFAULT NULL
)
RETURNS public.calls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.calls;
BEGIN
  SELECT * INTO v_row
  FROM public.apply_call_action_v2(
    p_call_id,
    p_site_id,
    p_stage,
    p_actor_id,
    p_lead_score,
    '{}'::jsonb,
    p_version,
    p_metadata,
    p_caller_phone_raw,
    p_caller_phone_e164,
    p_caller_phone_hash
  )
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'apply_call_action_v2 returned no row or version mismatch';
  END IF;

  UPDATE public.calls c
  SET
    reviewed_at = CASE WHEN coalesce(p_reviewed, true) THEN timezone('utc', now()) ELSE NULL END,
    reviewed_by = CASE WHEN coalesce(p_reviewed, true) THEN p_actor_id ELSE NULL END
  WHERE c.id = p_call_id
    AND c.site_id = p_site_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_call_action_v2(uuid, uuid, text, uuid, integer, jsonb, integer, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_call_action_v2(uuid, uuid, text, uuid, integer, jsonb, integer, jsonb, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.apply_call_action_v2(uuid, uuid, text, uuid, integer, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_call_action_v2(uuid, uuid, text, uuid, integer, integer, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.apply_call_action_with_review_v1(uuid, uuid, text, uuid, integer, integer, jsonb, boolean, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_call_action_with_review_v1(uuid, uuid, text, uuid, integer, integer, jsonb, boolean, text, text, text) TO authenticated, service_role;

COMMIT;
