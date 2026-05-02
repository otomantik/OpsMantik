BEGIN;

UPDATE public.sites
SET oci_api_key = public.generate_oci_api_key_v1();

COMMIT;
