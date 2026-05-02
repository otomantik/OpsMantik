BEGIN;

CREATE OR REPLACE FUNCTION public.generate_oci_api_key_v1()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  -- Supabase pgcrypto lives under "extensions" schema in hosted environments.
  v_token := replace(
    replace(
      replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'),
      '/',
      '_'
    ),
    '=',
    ''
  );
  RETURN 'oci_' || v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_oci_api_key_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_oci_api_key_v1() TO service_role;

COMMIT;
