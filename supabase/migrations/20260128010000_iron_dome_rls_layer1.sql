-- Migration: Iron Dome v2.1 - Layer 1: Enhanced RLS Policies (Fail-Closed)
-- Date: 2026-01-28
-- Purpose: Triple-layer tenant isolation - Database layer (Layer 1)
-- Note: These policies work alongside existing RLS policies for defense in depth

-- ============================================
-- Enhanced RLS Policies for Tenant Isolation
-- ============================================

-- Sessions: Enhanced tenant isolation with explicit site_id check
-- Note: Existing policy already checks site ownership/membership, this adds explicit site_id validation
DROP POLICY IF EXISTS "sessions_tenant_isolation_iron_dome" ON public.sessions;
CREATE POLICY "sessions_tenant_isolation_iron_dome" ON public.sessions
  FOR ALL 
  USING (
    -- Explicit site_id check (defense in depth)
    site_id IN (
      SELECT id FROM public.sites 
      WHERE (
        user_id = auth.uid() 
        OR EXISTS (
          SELECT 1 FROM public.site_members 
          WHERE site_members.site_id = sites.id 
          AND site_members.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE id = auth.uid() AND role = 'admin'
        )
      )
    )
  )
  WITH CHECK (
    -- Same check for INSERT/UPDATE
    site_id IN (
      SELECT id FROM public.sites 
      WHERE (
        user_id = auth.uid() 
        OR EXISTS (
          SELECT 1 FROM public.site_members 
          WHERE site_members.site_id = sites.id 
          AND site_members.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE id = auth.uid() AND role = 'admin'
        )
      )
    )
  );

-- Events: Enhanced tenant isolation via session ownership
DROP POLICY IF EXISTS "events_tenant_isolation_iron_dome" ON public.events;
CREATE POLICY "events_tenant_isolation_iron_dome" ON public.events
  FOR ALL
  USING (
    -- Events are isolated via their session's site_id
    session_id IN (
      SELECT s.id FROM public.sessions s
      WHERE s.site_id IN (
        SELECT id FROM public.sites 
        WHERE (
          user_id = auth.uid() 
          OR EXISTS (
            SELECT 1 FROM public.site_members 
            WHERE site_members.site_id = sites.id 
            AND site_members.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role = 'admin'
          )
        )
      )
      AND s.created_month = events.session_month
    )
  )
  WITH CHECK (
    -- Same check for INSERT/UPDATE
    session_id IN (
      SELECT s.id FROM public.sessions s
      WHERE s.site_id IN (
        SELECT id FROM public.sites 
        WHERE (
          user_id = auth.uid() 
          OR EXISTS (
            SELECT 1 FROM public.site_members 
            WHERE site_members.site_id = sites.id 
            AND site_members.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role = 'admin'
          )
        )
      )
      AND s.created_month = events.session_month
    )
  );

-- Calls: Enhanced tenant isolation with explicit site_id check
DROP POLICY IF EXISTS "calls_tenant_isolation_iron_dome" ON public.calls;
CREATE POLICY "calls_tenant_isolation_iron_dome" ON public.calls
  FOR ALL
  USING (
    -- Explicit site_id check
    site_id IN (
      SELECT id FROM public.sites 
      WHERE (
        user_id = auth.uid() 
        OR EXISTS (
          SELECT 1 FROM public.site_members 
          WHERE site_members.site_id = sites.id 
          AND site_members.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE id = auth.uid() AND role = 'admin'
        )
      )
    )
  )
  WITH CHECK (
    -- Same check for INSERT/UPDATE
    site_id IN (
      SELECT id FROM public.sites 
      WHERE (
        user_id = auth.uid() 
        OR EXISTS (
          SELECT 1 FROM public.site_members 
          WHERE site_members.site_id = sites.id 
          AND site_members.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE id = auth.uid() AND role = 'admin'
        )
      )
    )
  );

-- Note: These policies work alongside existing RLS policies for defense in depth.
-- The existing policies remain active, and these provide additional explicit checks.

COMMENT ON POLICY "sessions_tenant_isolation_iron_dome" ON public.sessions IS 'Iron Dome Layer 1: Explicit site_id validation for tenant isolation (defense in depth)';
COMMENT ON POLICY "events_tenant_isolation_iron_dome" ON public.events IS 'Iron Dome Layer 1: Events isolated via session site_id validation (defense in depth)';
COMMENT ON POLICY "calls_tenant_isolation_iron_dome" ON public.calls IS 'Iron Dome Layer 1: Explicit site_id validation for calls (defense in depth)';
