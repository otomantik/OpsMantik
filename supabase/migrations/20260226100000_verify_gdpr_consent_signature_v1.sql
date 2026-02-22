-- GDPR Consent signature verifier (isolated from verify_call_event_signature_v1).
-- Signed payload: ts|nonce|site_id|identifier_type|identifier_value|scopes_json|consent_at
-- Replay protection: ts within 5 min window.
BEGIN;
CREATE OR REPLACE FUNCTION public.verify_gdpr_consent_signature_v1(
  p_site_public_id text,
  p_ts bigint,
  p_nonce text,
  p_identifier_type text,
  p_identifier_value text,
  p_consent_scopes_json text,
  p_consent_at text,
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
  IF p_nonce IS NULL OR length(trim(p_nonce)) = 0 THEN
    RETURN false;
  END IF;
  IF p_signature IS NULL OR length(p_signature) <> 64 THEN
    RETURN false;
  END IF;
  v_now := extract(epoch from now())::bigint;
  IF v_now - p_ts > 300 THEN
    RETURN false;
  END IF;
  IF p_ts - v_now > 60 THEN
    RETURN false;
  END IF;
  SELECT id INTO v_site_id FROM public.sites WHERE public_id = p_site_public_id LIMIT 1;
  IF v_site_id IS NULL THEN RETURN false; END IF;
  SELECT current_secret, next_secret INTO v_curr, v_next FROM private.site_secrets WHERE site_id = v_site_id;
  IF v_curr IS NULL OR length(trim(v_curr)) = 0 THEN RETURN false; END IF;
  v_msg := p_ts::text || '|' || COALESCE(p_nonce, '') || '|' || p_site_public_id || '|'
    || COALESCE(p_identifier_type, '') || '|' || COALESCE(p_identifier_value, '') || '|'
    || COALESCE(p_consent_scopes_json, '[]') || '|' || COALESCE(p_consent_at, '');
  v_expected := encode(extensions.hmac(convert_to(v_msg, 'utf8'), convert_to(v_curr, 'utf8'), 'sha256'), 'hex');
  IF lower(v_expected) = lower(p_signature) THEN RETURN true; END IF;
  IF v_next IS NOT NULL AND length(trim(v_next)) > 0 THEN
    v_expected := encode(extensions.hmac(convert_to(v_msg, 'utf8'), convert_to(v_next, 'utf8'), 'sha256'), 'hex');
    IF lower(v_expected) = lower(p_signature) THEN RETURN true; END IF;
  END IF;
  RETURN false;
END;
$$;
COMMENT ON FUNCTION public.verify_gdpr_consent_signature_v1(text, bigint, text, text, text, text, text, text) IS
  'GDPR consent HMAC verifier. Replay: ts within 5 min.';
REVOKE ALL ON FUNCTION public.verify_gdpr_consent_signature_v1(text, bigint, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_gdpr_consent_signature_v1(text, bigint, text, text, text, text, text, text) TO anon, authenticated, service_role;
COMMIT;
