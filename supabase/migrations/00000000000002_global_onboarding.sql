BEGIN;

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';

CREATE TABLE IF NOT EXISTS public.site_allowed_origins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  origin text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  verification_state text NOT NULL DEFAULT 'trusted' CHECK (verification_state IN ('pending', 'verified', 'trusted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, origin)
);

ALTER TABLE public.site_allowed_origins ENABLE ROW LEVEL SECURITY;

CREATE POLICY site_allowed_origins_read ON public.site_allowed_origins
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.site_memberships m
    WHERE m.site_id = site_allowed_origins.site_id
      AND m.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.sites s
    WHERE s.id = site_allowed_origins.site_id
      AND s.user_id = auth.uid()
  )
);

CREATE POLICY site_allowed_origins_service_role_write ON public.site_allowed_origins
FOR ALL USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims text;
  v_claim_role text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  ) THEN
    RETURN true;
  END IF;

  v_claim_role := lower(coalesce(current_setting('request.jwt.claim.role', true), ''));
  IF v_claim_role IN ('admin', 'super_admin', 'superadmin') THEN
    RETURN true;
  END IF;

  v_claims := current_setting('request.jwt.claims', true);
  IF v_claims IS NOT NULL
     AND lower(coalesce((v_claims::jsonb ->> 'role'), '')) IN ('admin', 'super_admin', 'superadmin') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMIT;
