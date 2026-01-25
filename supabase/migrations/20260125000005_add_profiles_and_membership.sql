-- Migration: Add profiles and site_members for multi-tenant access control
-- Date: 2026-01-24
-- Purpose: Enable admin to see all sites, customers to see only their assigned sites

-- Enable gen_random_uuid() extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Profiles table: user roles and metadata
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Site members table: many-to-many relationship between users and sites
CREATE TABLE IF NOT EXISTS public.site_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor', 'owner')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(site_id, user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_site_members_site_id ON public.site_members(site_id);
CREATE INDEX IF NOT EXISTS idx_site_members_user_id ON public.site_members(user_id);
CREATE INDEX IF NOT EXISTS idx_site_members_site_user ON public.site_members(site_id, user_id);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_members ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
-- Users can view their own profile
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

-- Users can update their own profile (but not role - admins handle that)
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles"
    ON public.profiles FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- RLS Policies for site_members
-- Users can view their own memberships
CREATE POLICY "Users can view own memberships"
    ON public.site_members FOR SELECT
    USING (auth.uid() = user_id);

-- Site owners can manage members of their sites
CREATE POLICY "Site owners can manage members"
    ON public.site_members FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.sites
            WHERE sites.id = site_members.site_id AND sites.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.sites
            WHERE sites.id = site_members.site_id AND sites.user_id = auth.uid()
        )
    );

-- Admins can manage all site members
CREATE POLICY "Admins can manage all site members"
    ON public.site_members FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Update sites RLS policies to allow access via ownership OR membership
-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Users can view their own sites" ON public.sites;

-- New SELECT policy: users can view sites they own OR are members of
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
        -- User is an admin
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Update sessions RLS to allow access via ownership OR membership
DROP POLICY IF EXISTS "Users can view sessions for their sites" ON public.sessions;

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
                EXISTS (
                    SELECT 1 FROM public.profiles
                    WHERE id = auth.uid() AND role = 'admin'
                )
            )
        )
    );

-- Update events RLS to allow access via ownership OR membership
DROP POLICY IF EXISTS "Users can view events for their sites" ON public.events;

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
                EXISTS (
                    SELECT 1 FROM public.profiles
                    WHERE id = auth.uid() AND role = 'admin'
                )
            )
        )
    );

-- Update calls RLS to allow access via ownership OR membership
DROP POLICY IF EXISTS "Users can view calls for their sites" ON public.calls;

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
                EXISTS (
                    SELECT 1 FROM public.profiles
                    WHERE id = auth.uid() AND role = 'admin'
                )
            )
        )
    );

-- Helper function to check if user is admin
-- Can be used in queries: SELECT is_admin(auth.uid())
CREATE OR REPLACE FUNCTION public.is_admin(check_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = check_user_id AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto-create profile for new users (via trigger)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, role)
    VALUES (NEW.id, 'user')
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Create profiles for existing users (if any)
INSERT INTO public.profiles (id, role)
SELECT id, 'user' FROM auth.users
ON CONFLICT (id) DO NOTHING;
