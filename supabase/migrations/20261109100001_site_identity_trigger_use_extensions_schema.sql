-- Fix: gen_random_bytes() in Supabase lives in the "extensions" schema (pgcrypto).
-- Trigger had search_path = public so it failed with 42883. Use extensions.gen_random_bytes.

CREATE OR REPLACE FUNCTION public.sites_before_insert_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.public_id IS NULL OR trim(NEW.public_id) = '' THEN
    NEW.public_id := 'site-' || encode(extensions.gen_random_bytes(6), 'hex');
  END IF;

  IF NEW.oci_api_key IS NULL OR trim(NEW.oci_api_key) = '' THEN
    NEW.oci_api_key := encode(extensions.gen_random_bytes(32), 'hex');
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sites_before_insert_identity() IS 'Identity Protocol: auto public_id and oci_api_key on Site creation. Uses extensions.gen_random_bytes (pgcrypto).';
