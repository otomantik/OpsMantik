BEGIN;

-- Compatibility layer: runtime code still queries public.profiles for admin role.
-- Canonical admin source in this stack is auth.users metadata.
CREATE OR REPLACE VIEW public.profiles AS
SELECT
  u.id,
  COALESCE(
    NULLIF(LOWER(TRIM(u.raw_app_meta_data ->> 'role')), ''),
    NULLIF(LOWER(TRIM(u.raw_user_meta_data ->> 'role')), ''),
    'user'
  ) AS role
FROM auth.users u;

GRANT SELECT ON public.profiles TO anon, authenticated, service_role;

COMMIT;
