'use server';

import { createClient } from '@/lib/supabase/server';
import { cache } from 'react';

/**
 * Server-only utility to check if the current user is an admin.
 * Uses cookie-based server Supabase client (createServerClient from @supabase/ssr).
 * 
 * Cached per request to avoid repeated database calls.
 * 
 * @returns {Promise<boolean>} true if current user has admin role, false otherwise
 */
export const isAdmin = cache(async (): Promise<boolean> => {
  const isDebug = process.env.NEXT_PUBLIC_WARROOM_DEBUG === 'true';
  
  try {
    // Get server Supabase client (cookie-based, uses createServerClient from @supabase/ssr)
    const supabase = await createClient();
    
    // Get current user from session (cookie-based)
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError) {
      if (isDebug) {
        console.log('[isAdmin] getUser error:', userError.message);
      }
      return false;
    }
    
    if (!user) {
      if (isDebug) {
        console.log('[isAdmin] No user found in session');
      }
      return false;
    }
    
    if (isDebug) {
      console.log('[isAdmin] Checking admin status for user:', user.id);
    }
    
    // Query profiles table for user's role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    
    if (profileError) {
      if (isDebug) {
        console.log('[isAdmin] Profile query error:', profileError.message, profileError.code);
      }
      // Profile doesn't exist or query failed - not admin (fail-safe)
      return false;
    }
    
    if (!profile) {
      if (isDebug) {
        console.log('[isAdmin] Profile not found for user:', user.id);
      }
      return false;
    }
    
    const isUserAdmin = profile.role === 'admin';
    
    if (isDebug) {
      console.log('[isAdmin] User role:', profile.role, '→ Admin:', isUserAdmin);
    }
    
    return isUserAdmin;
  } catch (error) {
    // On any error, assume not admin (fail-safe)
    if (isDebug) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[isAdmin] Exception checking admin status:', errorMessage);
    }
    return false;
  }
});
