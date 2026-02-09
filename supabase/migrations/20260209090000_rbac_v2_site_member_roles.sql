-- Migration: RBAC v2 — Site member roles (admin/operator/analyst/billing)
-- Date: 2026-02-09
-- Purpose:
--   - Replace legacy site_members.role values (viewer/editor/owner) with enterprise roles.
--   - Update RLS policies to enforce least privilege for writes.
-- Notes:
--   - Site "owner" remains sites.user_id (implicit).
--   - Platform admin remains profiles.role='admin' via public.is_admin().

BEGIN;

-- 1) Normalize roles (data migration)
-- Legacy mapping:
--   viewer  -> analyst (read-only)
--   editor  -> operator (can operate queue + updates)
--   owner   -> admin (site-level admin)
UPDATE public.site_members
SET role = CASE role
  WHEN 'viewer' THEN 'analyst'
  WHEN 'editor' THEN 'operator'
  WHEN 'owner'  THEN 'admin'
  ELSE role
END
WHERE role IN ('viewer', 'editor', 'owner');

-- 2) Enforce new role set (schema constraint + default)
ALTER TABLE public.site_members
  ALTER COLUMN role SET DEFAULT 'analyst';

-- Drop legacy check constraint (name depends on auto-generation).
ALTER TABLE public.site_members
  DROP CONSTRAINT IF EXISTS site_members_role_check;

ALTER TABLE public.site_members
  ADD CONSTRAINT site_members_role_check
  CHECK (role IN ('admin', 'operator', 'analyst', 'billing'));

COMMENT ON COLUMN public.site_members.role IS 'RBAC v2 site role: admin|operator|analyst|billing. Site owner is sites.user_id.';

-- Also migrate/normalize audit role values for customer invites (for consistent reporting)
UPDATE public.customer_invite_audit
SET role = CASE role
  WHEN 'viewer' THEN 'analyst'
  WHEN 'editor' THEN 'operator'
  WHEN 'owner'  THEN 'admin'
  ELSE role
END
WHERE role IN ('viewer', 'editor', 'owner');

ALTER TABLE public.customer_invite_audit
  ALTER COLUMN role SET DEFAULT 'analyst';

ALTER TABLE public.customer_invite_audit
  DROP CONSTRAINT IF EXISTS customer_invite_audit_role_check;

ALTER TABLE public.customer_invite_audit
  ADD CONSTRAINT customer_invite_audit_role_check
  CHECK (role IN ('admin', 'operator', 'analyst', 'billing'));

-- 3) RLS: site_members management
-- Replace broad "owners can manage" with: site owner OR site member admin OR platform admin.
DROP POLICY IF EXISTS "Site owners can manage members" ON public.site_members;
DROP POLICY IF EXISTS "Admins can manage all site members" ON public.site_members;

CREATE POLICY "Site owners and site admins can manage members"
  ON public.site_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.site_members.site_id
        AND (
          s.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.site_members sm2
            WHERE sm2.site_id = s.id
              AND sm2.user_id = auth.uid()
              AND sm2.role = 'admin'
          )
          OR public.is_admin(auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.site_members.site_id
        AND (
          s.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.site_members sm2
            WHERE sm2.site_id = s.id
              AND sm2.user_id = auth.uid()
              AND sm2.role = 'admin'
          )
          OR public.is_admin(auth.uid())
        )
    )
  );

COMMENT ON POLICY "Site owners and site admins can manage members" ON public.site_members IS
  'RBAC v2: Site owner, site admin member, or platform admin can manage site_members.';

-- 4) RLS: sites UPDATE (config edits) — owner OR admin/operator OR platform admin
DROP POLICY IF EXISTS "Site owners and editors can update sites" ON public.sites;

CREATE POLICY "Site owners and operators can update sites"
  ON public.sites FOR UPDATE
  USING (
    (public.sites.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.site_members sm
      WHERE sm.site_id = public.sites.id
        AND sm.user_id = auth.uid()
        AND sm.role IN ('admin', 'operator')
    )
    OR public.is_admin(auth.uid())
  )
  WITH CHECK (
    (public.sites.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.site_members sm
      WHERE sm.site_id = public.sites.id
        AND sm.user_id = auth.uid()
        AND sm.role IN ('admin', 'operator')
    )
    OR public.is_admin(auth.uid())
  );

COMMENT ON POLICY "Site owners and operators can update sites" ON public.sites IS
  'RBAC v2: Only site owner, admin/operator member, or platform admin can UPDATE sites.';

-- 5) RLS: calls UPDATE/INSERT/DELETE — owner OR admin/operator OR platform admin
DROP POLICY IF EXISTS "calls_update_own_site_members" ON public.calls;
DROP POLICY IF EXISTS "calls_update_owner_editor_admin" ON public.calls;
DROP POLICY IF EXISTS "calls_insert_owner_editor_admin" ON public.calls;
DROP POLICY IF EXISTS "calls_delete_owner_editor_admin" ON public.calls;

CREATE POLICY "calls_update_owner_operator_admin"
  ON public.calls FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.calls.site_id
        AND (
          s.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s.id
              AND sm.user_id = auth.uid()
              AND sm.role IN ('admin', 'operator')
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
            WHERE sm.site_id = s.id
              AND sm.user_id = auth.uid()
              AND sm.role IN ('admin', 'operator')
          )
          OR public.is_admin(auth.uid())
        )
    )
  );

CREATE POLICY "calls_insert_owner_operator_admin"
  ON public.calls FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.calls.site_id
        AND (
          s.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s.id
              AND sm.user_id = auth.uid()
              AND sm.role IN ('admin', 'operator')
          )
          OR public.is_admin(auth.uid())
        )
    )
  );

CREATE POLICY "calls_delete_owner_operator_admin"
  ON public.calls FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = public.calls.site_id
        AND (
          s.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s.id
              AND sm.user_id = auth.uid()
              AND sm.role IN ('admin', 'operator')
          )
          OR public.is_admin(auth.uid())
        )
    )
  );

COMMENT ON POLICY "calls_update_owner_operator_admin" ON public.calls IS
  'RBAC v2: Only owner/admin/operator member or platform admin can UPDATE calls.';
COMMENT ON POLICY "calls_insert_owner_operator_admin" ON public.calls IS
  'RBAC v2: Only owner/admin/operator member or platform admin can INSERT calls.';
COMMENT ON POLICY "calls_delete_owner_operator_admin" ON public.calls IS
  'RBAC v2: Only owner/admin/operator member or platform admin can DELETE calls.';

-- 6) RLS: call_actions INSERT (append-only) — owner OR admin/operator OR platform admin
DROP POLICY IF EXISTS "call_actions_insert_owner_editor_admin" ON public.call_actions;

CREATE POLICY "call_actions_insert_owner_operator_admin"
  ON public.call_actions FOR INSERT
  WITH CHECK (
    (SELECT s.user_id FROM public.sites s WHERE s.id = public.call_actions.site_id LIMIT 1) = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.site_members sm
      WHERE sm.user_id = auth.uid()
        AND sm.site_id = public.call_actions.site_id
        AND sm.role IN ('admin','operator')
    )
    OR public.is_admin(auth.uid())
  );

COMMENT ON POLICY "call_actions_insert_owner_operator_admin" ON public.call_actions IS
  'RBAC v2: Only owner/admin/operator member or platform admin can INSERT call_actions (analyst/billing cannot).';

COMMIT;

