'use server';

import { createClient } from '@/lib/supabase/server';
import { cache } from 'react';
import { logWarn, logError } from '@/lib/logging/logger';

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
      if (isDebug) logWarn('isAdmin_getUser_error', { message: userError.message });
      return false;
    }
    
    if (!user) {
      if (isDebug) logWarn('isAdmin_no_user');
      return false;
    }
    
    if (isDebug) logWarn('isAdmin_checking_role');
    
    // Query profiles table for user's role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    
    if (profileError) {
      if (isDebug) logWarn('isAdmin_profile_error', { code: profileError.code });
      // Profile doesn't exist or query failed - not admin (fail-safe)
      return false;
    }
    
    if (!profile) {
      if (isDebug) logWarn('isAdmin_profile_not_found');
      return false;
    }
    
    const isUserAdmin = profile.role === 'admin';
    
    if (isDebug) logWarn('isAdmin_role_result', { role: profile.role, isAdmin: isUserAdmin });
    
    return isUserAdmin;
  } catch (error) {
    // On any error, assume not admin (fail-safe)
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError('isAdmin_exception', { message: errorMessage });
    return false;
  }
});
