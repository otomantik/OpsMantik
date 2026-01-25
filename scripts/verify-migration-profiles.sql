-- Verification queries for profiles and site_members migration
-- Run these in Supabase SQL Editor to verify migration success

-- 1. Check profiles table exists
SELECT 
    table_name, 
    column_name, 
    data_type, 
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'profiles'
ORDER BY ordinal_position;

-- 2. Check site_members table exists
SELECT 
    table_name, 
    column_name, 
    data_type, 
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'site_members'
ORDER BY ordinal_position;

-- 3. Check RLS is enabled
SELECT 
    schemaname, 
    tablename, 
    rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('profiles', 'site_members');

-- 4. Check RLS policies exist
SELECT 
    schemaname, 
    tablename, 
    policyname, 
    permissive, 
    roles, 
    cmd
FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename IN ('profiles', 'site_members', 'sites', 'sessions', 'events', 'calls')
ORDER BY tablename, policyname;

-- 5. Check is_admin function exists
SELECT 
    routine_name, 
    routine_type, 
    data_type
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name = 'is_admin';

-- 6. Check trigger exists
SELECT 
    trigger_name, 
    event_manipulation, 
    event_object_table, 
    action_statement
FROM information_schema.triggers 
WHERE trigger_schema = 'auth' 
  AND trigger_name = 'on_auth_user_created';

-- 7. Count existing profiles (should match auth.users count)
SELECT 
    (SELECT COUNT(*) FROM auth.users) as total_users,
    (SELECT COUNT(*) FROM public.profiles) as total_profiles;

-- 8. Test is_admin function (replace with your user ID)
-- SELECT public.is_admin('YOUR_USER_ID_HERE');
