-- Migration: GO 2.1 — Fix RLS for sites.config + harden calls UPDATE (whitelist)
-- Date: 2026-01-30
-- Purpose:
--   A) sites: only OWNER and EDITOR (site_members.role in ['owner','editor']) and admin can UPDATE (viewers cannot).
--   B) calls: only owner/editor/admin can UPDATE; seal path updates only allowed columns (trigger already enforces).
--   C) Seal API uses site_id from DB only (no client authority).

BEGIN;

-- ============================================
-- A) sites UPDATE: owner OR editor/owner member OR admin (viewers cannot update)
-- ============================================
DROP POLICY IF EXISTS "Users can update their own sites" ON public.sites;
DROP POLICY IF EXISTS "Admins can update sites" ON public.sites;
DROP POLICY IF EXISTS "Site owners and editors can update sites" ON public.sites;

CREATE POLICY "Site owners and editors can update sites"
  ON public.sites FOR UPDATE
  USING (
    (public.sites.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.site_members sm
      WHERE sm.site_id = public.sites.id
        AND sm.user_id = auth.uid()
        AND sm.role IN ('owner', 'editor')
    )
    OR public.is_admin(auth.uid())
  )
  WITH CHECK (
    (public.sites.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.site_members sm
      WHERE sm.site_id = public.sites.id
        AND sm.user_id = auth.uid()
        AND sm.role IN ('owner', 'editor')
    )
    OR public.is_admin(auth.uid())
  );

COMMENT ON POLICY "Site owners and editors can update sites" ON public.sites IS 'GO 2.1: Only site owner, site_members with role owner/editor, or admin can UPDATE (viewers cannot).';

-- ============================================
-- B) calls: SELECT unchanged; UPDATE only owner/editor/admin (viewers cannot update)
-- ============================================
-- Replace FOR ALL with separate SELECT and UPDATE so UPDATE can restrict to owner/editor/admin.
DROP POLICY IF EXISTS "calls_tenant_isolation_iron_dome" ON public.calls;
DROP POLICY IF EXISTS "calls_select_accessible" ON public.calls;
DROP POLICY IF EXISTS "calls_update_owner_editor_admin" ON public.calls;
DROP POLICY IF EXISTS "calls_insert_owner_editor_admin" ON public.calls;
DROP POLICY IF EXISTS "calls_delete_owner_editor_admin" ON public.calls;

-- SELECT: owner or any member or admin (unchanged behavior)
CREATE POLICY "calls_select_accessible"
  ON public.calls FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.calls.site_id
        AND (
          s.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s.id AND sm.user_id = auth.uid()
          )
          OR public.is_admin(auth.uid())
        )
    )
  );

-- UPDATE: only owner or site_members.role in ('owner','editor') or admin (viewers cannot update)
CREATE POLICY "calls_update_owner_editor_admin"
  ON public.calls FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.calls.site_id
        AND (
          s.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s.id AND sm.user_id = auth.uid() AND sm.role IN ('owner', 'editor')
          )
          OR public.is_admin(auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.calls.site_id
        AND (
          s.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s.id AND sm.user_id = auth.uid() AND sm.role IN ('owner', 'editor')
          )
          OR public.is_admin(auth.uid())
        )
    )
  );

COMMENT ON POLICY "calls_select_accessible" ON public.calls IS 'GO 2.1: Owner, any member, or admin can SELECT calls for their site.';
COMMENT ON POLICY "calls_update_owner_editor_admin" ON public.calls IS 'GO 2.1: Only owner, editor/owner member, or admin can UPDATE calls (viewers cannot).';

-- INSERT/DELETE: restrict to owner/editor/admin so behavior is consistent (no INSERT/DELETE from anon for viewers)
CREATE POLICY "calls_insert_owner_editor_admin"
  ON public.calls FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.calls.site_id
        AND (
          s.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s.id AND sm.user_id = auth.uid() AND sm.role IN ('owner', 'editor')
          )
          OR public.is_admin(auth.uid())
        )
    )
  );

CREATE POLICY "calls_delete_owner_editor_admin"
  ON public.calls FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.calls.site_id
        AND (
          s.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s.id AND sm.user_id = auth.uid() AND sm.role IN ('owner', 'editor')
          )
          OR public.is_admin(auth.uid())
        )
    )
  );

COMMIT;
