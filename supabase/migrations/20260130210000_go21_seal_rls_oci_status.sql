-- Migration: GO 2.1 — Seal Deal RLS + oci_status safety
-- Date: 2026-01-30
-- Purpose:
--   A) calls: add UPDATE policy calls_update_own_site_members (owner or editor of site).
--   B) calls: ensure oci_status column exists (API writes 'sealed').
--   C) sites: policy for config edit already in 20260130200000 (owners/editors can update).
-- Security: Seal API uses site_id from DB only (not from client body).

BEGIN;

-- ============================================
-- A) calls: UPDATE policy — owner or editor of site (viewers cannot update)
-- ============================================
DROP POLICY IF EXISTS "calls_update_owner_editor_admin" ON public.calls;
DROP POLICY IF EXISTS "calls_update_own_site_members" ON public.calls;

CREATE POLICY "calls_update_own_site_members"
  ON public.calls FOR UPDATE
  USING (
    -- Site owner (sites.user_id = auth.uid())
    (SELECT s.user_id FROM public.sites s WHERE s.id = public.calls.site_id LIMIT 1) = auth.uid()
    OR
    -- Site member with role owner or editor (viewer cannot update)
    EXISTS (
      SELECT 1 FROM public.site_members sm
      WHERE sm.user_id = auth.uid()
        AND sm.site_id = public.calls.site_id
        AND sm.role IN ('owner', 'editor')
    )
    OR public.is_admin(auth.uid())
  )
  WITH CHECK (
    (SELECT s.user_id FROM public.sites s WHERE s.id = public.calls.site_id LIMIT 1) = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.site_members sm
      WHERE sm.user_id = auth.uid()
        AND sm.site_id = public.calls.site_id
        AND sm.role IN ('owner', 'editor')
    )
    OR public.is_admin(auth.uid())
  );

COMMENT ON POLICY "calls_update_own_site_members" ON public.calls IS 'GO 2.1 Seal: Site owner, or site_members with role owner/editor, or admin can UPDATE calls (viewers cannot).';

-- ============================================
-- B) calls: ensure oci_status (and related) exist for Seal API
-- ============================================
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS oci_status text,
  ADD COLUMN IF NOT EXISTS oci_status_updated_at timestamptz;

COMMENT ON COLUMN public.calls.oci_status IS 'OCI pipeline status: sealed|uploading|uploaded|failed|skipped (Seal API sets to sealed).';

COMMIT;
