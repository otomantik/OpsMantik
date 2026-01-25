'use server';

import { createClient } from '@/lib/supabase/server';
import { cache } from 'react';

/**
 * Server-only utility to check if the current user is an admin.
 * Uses cookie-based server Supabase client (no service role).
 * 
 * Cached per request to avoid repeated database calls.
 * 
 * @returns {Promise<boolean>} true if current user has admin role, false otherwise
 */
export const isAdmin = cache(async (): Promise<boolean> => {
  try {
    const supabase = await createClient();
    
    // Get current user from session (cookie-based)
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return false;
    }
    
    // Query profiles table for user's role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    
    if (profileError || !profile) {
      // Profile doesn't exist or query failed - not admin
      return false;
    }
    
    return profile.role === 'admin';
  } catch (error) {
    // On any error, assume not admin (fail-safe)
    if (process.env.NEXT_PUBLIC_WARROOM_DEBUG === 'true') {
      console.error('[isAdmin] Error checking admin status:', error);
    }
    return false;
  }
});
