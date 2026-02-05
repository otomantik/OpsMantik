-- Migration: Site identifier normalization (UUID vs 32-hex public_id)
-- Date: 2026-02-05
--
-- Adds:
-- - public.resolve_site_identifier_v1(input text) -> uuid | null
-- Updates:
-- - public.verify_call_event_signature_v1 to accept either UUID or public_id as identifier

BEGIN;

-- Resolve either a canonical site UUID (sites.id) or a 32-hex public id (sites.public_id)
-- into the canonical UUID. Returns NULL when unknown/invalid.
CREATE OR REPLACE FUNCTION public.resolve_site_identifier_v1(p_input text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_id uuid;
BEGIN
  IF p_input IS NULL OR length(trim(p_input)) = 0 THEN
    RETURN NULL;
  END IF;

  -- 1) UUID path (must exist in sites)
  BEGIN
    v_site_id := p_input::uuid;
    SELECT s.id INTO v_site_id
    FROM public.sites s
    WHERE s.id = v_site_id
    LIMIT 1;

    IF v_site_id IS NOT NULL THEN
      RETURN v_site_id;
    END IF;
  EXCEPTION WHEN others THEN
    -- ignore invalid UUID casts
    NULL;
  END;

  -- 2) 32-hex public id path
  IF p_input ~* '^[a-f0-9]{32}$' THEN
    SELECT s.id INTO v_site_id
    FROM public.sites s
    WHERE s.public_id = lower(p_input)
    LIMIT 1;
    RETURN v_site_id;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_site_identifier_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_site_identifier_v1(text) TO anon, authenticated, service_role;

-- Update verifier RPC to accept either UUID or public_id as p_site_public_id (identifier).
CREATE OR REPLACE FUNCTION public.verify_call_event_signature_v1(
  p_site_public_id text,
  p_ts bigint,
  p_raw_body text,
  p_signature text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_site_id uuid;
  v_curr text;
  v_next text;
  v_msg text;
  v_expected text;
  v_now bigint;
BEGIN
  IF p_site_public_id IS NULL OR length(trim(p_site_public_id)) = 0 THEN
    RETURN false;
  END IF;
  IF p_ts IS NULL OR p_ts <= 0 THEN
    RETURN false;
  END IF;
  IF p_signature IS NULL OR length(p_signature) <> 64 THEN
    RETURN false;
  END IF;

  -- Replay window protection (same contract as API layer)
  v_now := extract(epoch from now())::bigint;
  IF v_now - p_ts > 300 THEN
    RETURN false;
  END IF;
  IF p_ts - v_now > 60 THEN
    RETURN false;
  END IF;

  v_site_id := public.resolve_site_identifier_v1(p_site_public_id);
  IF v_site_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT current_secret, next_secret
  INTO v_curr, v_next
  FROM private.site_secrets
  WHERE site_id = v_site_id;

  IF v_curr IS NULL OR length(trim(v_curr)) = 0 THEN
    RETURN false;
  END IF;

  v_msg := p_ts::text || '.' || COALESCE(p_raw_body, '');

  v_expected := encode(
    extensions.hmac(convert_to(v_msg, 'utf8'), convert_to(v_curr, 'utf8'), 'sha256'),
    'hex'
  );
  IF lower(v_expected) = lower(p_signature) THEN
    RETURN true;
  END IF;

  IF v_next IS NOT NULL AND length(trim(v_next)) > 0 THEN
    v_expected := encode(
      extensions.hmac(convert_to(v_msg, 'utf8'), convert_to(v_next, 'utf8'), 'sha256'),
      'hex'
    );
    IF lower(v_expected) = lower(p_signature) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_call_event_signature_v1(text, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_call_event_signature_v1(text, bigint, text, text) TO anon, authenticated, service_role;

COMMIT;

