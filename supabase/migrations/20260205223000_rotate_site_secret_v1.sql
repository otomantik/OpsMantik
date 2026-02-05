-- Migration: admin-only RPC to set/rotate per-site tracker secrets
-- Date: 2026-02-05
--
-- Exposes a service-role-only function in public schema so it can be called via PostgREST
-- for provisioning/rotation workflows (CI/admin tooling).

BEGIN;

CREATE OR REPLACE FUNCTION public.rotate_site_secret_v1(
  p_site_public_id text,
  p_current_secret text,
  p_next_secret text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_site_id uuid;
BEGIN
  IF p_site_public_id IS NULL OR length(trim(p_site_public_id)) = 0 THEN
    RAISE EXCEPTION 'site_public_id is required';
  END IF;
  SELECT id INTO v_site_id
  FROM public.sites
  WHERE public_id = p_site_public_id
  LIMIT 1;

  IF v_site_id IS NULL THEN
    RAISE EXCEPTION 'site not found';
  END IF;

  PERFORM private.set_site_secrets_v1(v_site_id, p_current_secret, p_next_secret);
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_site_secret_v1(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rotate_site_secret_v1(text, text, text) TO service_role;

COMMIT;

