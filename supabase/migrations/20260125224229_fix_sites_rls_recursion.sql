-- Migration: Fix infinite recursion in sites RLS policy
-- Date: 2026-01-25
-- Purpose: Replace direct profiles query with is_admin() function to avoid RLS recursion

-- Drop existing policy
DROP POLICY IF EXISTS "Users can view owned or member sites" ON public.sites;

-- Recreate policy using is_admin() function (SECURITY DEFINER, bypasses RLS)
CREATE POLICY "Users can view owned or member sites"
    ON public.sites FOR SELECT
    USING (
        -- User owns the site
        sites.user_id = auth.uid()
        OR
        -- User is a member of the site
        EXISTS (
            SELECT 1 FROM public.site_members
            WHERE site_members.site_id = sites.id AND site_members.user_id = auth.uid()
        )
        OR
        -- User is an admin (using SECURITY DEFINER function to avoid RLS recursion)
        public.is_admin()
    );

-- Also update sessions policy to use is_admin() for consistency
DROP POLICY IF EXISTS "Users can view sessions for accessible sites" ON public.sessions;

CREATE POLICY "Users can view sessions for accessible sites"
    ON public.sessions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.sites
            WHERE sites.id = sessions.site_id
            AND (
                sites.user_id = auth.uid()
                OR
                EXISTS (
                    SELECT 1 FROM public.site_members
                    WHERE site_members.site_id = sites.id AND site_members.user_id = auth.uid()
                )
                OR
                public.is_admin()
            )
        )
    );

-- Update events policy
DROP POLICY IF EXISTS "Users can view events for accessible sites" ON public.events;

CREATE POLICY "Users can view events for accessible sites"
    ON public.events FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.sites
            JOIN public.sessions ON sites.id = sessions.site_id
            WHERE sessions.id = events.session_id
            AND (
                sites.user_id = auth.uid()
                OR
                EXISTS (
                    SELECT 1 FROM public.site_members
                    WHERE site_members.site_id = sites.id AND site_members.user_id = auth.uid()
                )
                OR
                public.is_admin()
            )
        )
    );

-- Update calls policy
DROP POLICY IF EXISTS "Users can view calls for accessible sites" ON public.calls;

CREATE POLICY "Users can view calls for accessible sites"
    ON public.calls FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.sites
            WHERE sites.id = calls.site_id
            AND (
                sites.user_id = auth.uid()
                OR
                EXISTS (
                    SELECT 1 FROM public.site_members
                    WHERE site_members.site_id = sites.id AND site_members.user_id = auth.uid()
                )
                OR
                public.is_admin()
            )
        )
    );
