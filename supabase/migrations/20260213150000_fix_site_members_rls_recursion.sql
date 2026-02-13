-- Migration: Fix infinite recursion in site_members RLS (42P17)
-- Date: 2026-02-13
-- Cause: Policy "Site owners and site admins can manage members" queried sites and site_members
--        from within site_members policy; sites SELECT policy queries site_members -> cycle.
-- Fix: Use a SECURITY DEFINER function so checks run without RLS recursion.

BEGIN;

-- Function: can current user manage site_members for this site?
-- (Site owner, or site member with role admin, or platform admin.)
-- SECURITY DEFINER bypasses RLS so no recursion when used in site_members policy.
CREATE OR REPLACE FUNCTION public.can_manage_site_members(_site_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sites s
    WHERE s.id = _site_id
      AND (
        s.user_id = auth.uid()
        OR public.is_admin(auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.site_members sm
          WHERE sm.site_id = s.id
            AND sm.user_id = auth.uid()
            AND sm.role = 'admin'
        )
      )
  );
$$;

COMMENT ON FUNCTION public.can_manage_site_members(uuid) IS
  'RBAC v2: True if current user can manage site_members for the site (owner, site admin, or platform admin). SECURITY DEFINER to avoid RLS recursion.';

GRANT EXECUTE ON FUNCTION public.can_manage_site_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_site_members(uuid) TO anon;

-- Replace policy that caused recursion with one that only uses auth.uid() and the definer function.
DROP POLICY IF EXISTS "Site owners and site admins can manage members" ON public.site_members;

CREATE POLICY "Site owners and site admins can manage members"
  ON public.site_members FOR ALL
  USING (
    (public.site_members.user_id = auth.uid())
    OR public.can_manage_site_members(public.site_members.site_id)
  )
  WITH CHECK (
    public.can_manage_site_members(public.site_members.site_id)
  );

COMMENT ON POLICY "Site owners and site admins can manage members" ON public.site_members IS
  'RBAC v2: See own row or manage via can_manage_site_members() (no RLS recursion).';

COMMIT;
