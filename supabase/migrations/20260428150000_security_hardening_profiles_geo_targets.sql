BEGIN;

-- 1) profiles view: keep compatibility for internal RPC usage, but prevent public exposure.
-- Avoid SECURITY DEFINER behavior by forcing invoker semantics on supported Postgres versions.
CREATE OR REPLACE VIEW public.profiles
WITH (security_invoker = true)
AS
SELECT
  u.id,
  COALESCE(
    NULLIF(LOWER(TRIM(u.raw_app_meta_data ->> 'role')), ''),
    NULLIF(LOWER(TRIM(u.raw_user_meta_data ->> 'role')), ''),
    'user'
  ) AS role
FROM auth.users u;

REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO service_role;

-- 2) google_geo_targets: enable RLS and preserve read behavior explicitly.
ALTER TABLE public.google_geo_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_geo_targets_read_all ON public.google_geo_targets;
CREATE POLICY google_geo_targets_read_all
ON public.google_geo_targets
FOR SELECT
USING (true);

DROP POLICY IF EXISTS google_geo_targets_service_write ON public.google_geo_targets;
CREATE POLICY google_geo_targets_service_write
ON public.google_geo_targets
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

COMMIT;
