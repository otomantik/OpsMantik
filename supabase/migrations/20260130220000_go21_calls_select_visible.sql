-- Migration: GO 2.1 — Calls SELECT visibility (owner, any member including viewer, admin)
-- Date: 2026-01-30
-- Purpose: Ensure authenticated users can SELECT calls for sites they can access.
--   - Site owner: sites.user_id = auth.uid()
--   - Site member (any role, including viewer): site_members.user_id = auth.uid()
--   - Admin: is_admin(auth.uid()) via profiles.role = 'admin'
-- Viewers must be allowed to SELECT (dashboard queue).

BEGIN;

DROP POLICY IF EXISTS "calls_select_accessible" ON public.calls;

CREATE POLICY "calls_select_accessible"
  ON public.calls FOR SELECT
  USING (
    -- Site owner
    (SELECT s.user_id FROM public.sites s WHERE s.id = public.calls.site_id LIMIT 1) = auth.uid()
    OR
    -- Any site member (owner, editor, viewer)
    EXISTS (
      SELECT 1 FROM public.site_members sm
      WHERE sm.site_id = public.calls.site_id AND sm.user_id = auth.uid()
    )
    OR public.is_admin(auth.uid())
  );

COMMENT ON POLICY "calls_select_accessible" ON public.calls IS 'GO 2.1: Owner, any member (incl viewer), or admin can SELECT calls for their site.';

COMMIT;
