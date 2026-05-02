BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.generate_oci_api_key_v1()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  -- 32-byte entropy, URL-safe, no padding.
  v_token := replace(replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=', '');
  RETURN 'oci_' || v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.sites_set_oci_api_key_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.oci_api_key IS NULL OR btrim(NEW.oci_api_key) = '' THEN
    NEW.oci_api_key := public.generate_oci_api_key_v1();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sites_set_oci_api_key_v1 ON public.sites;

CREATE TRIGGER trg_sites_set_oci_api_key_v1
BEFORE INSERT ON public.sites
FOR EACH ROW
EXECUTE FUNCTION public.sites_set_oci_api_key_v1();

REVOKE ALL ON FUNCTION public.generate_oci_api_key_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_oci_api_key_v1() TO service_role;

REVOKE ALL ON FUNCTION public.sites_set_oci_api_key_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sites_set_oci_api_key_v1() TO service_role;

COMMIT;
