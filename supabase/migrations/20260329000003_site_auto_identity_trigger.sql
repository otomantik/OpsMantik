-- Identity Protocol: Auto-generate public_id and oci_api_key on Site creation
-- Runs on every INSERT regardless of source (Dashboard, API, direct SQL).
-- No more manual UPDATE queries.

CREATE OR REPLACE FUNCTION public.sites_before_insert_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Slug-friendly public_id if not provided (null or empty)
  IF NEW.public_id IS NULL OR trim(NEW.public_id) = '' THEN
    NEW.public_id := 'site-' || encode(gen_random_bytes(6), 'hex');
  END IF;

  -- Secure oci_api_key if not provided
  IF NEW.oci_api_key IS NULL OR trim(NEW.oci_api_key) = '' THEN
    NEW.oci_api_key := encode(gen_random_bytes(32), 'hex');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sites_before_insert_identity_trigger ON public.sites;
CREATE TRIGGER sites_before_insert_identity_trigger
  BEFORE INSERT ON public.sites
  FOR EACH ROW
  EXECUTE FUNCTION public.sites_before_insert_identity();

COMMENT ON FUNCTION public.sites_before_insert_identity() IS 'Identity Protocol: auto public_id and oci_api_key on Site creation';
