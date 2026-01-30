/**
 * Iron Dome v2.1 - Layer 2: Server Gate
 * 
 * Validates site access for authenticated users.
 * Checks: owner, admin, or team member via site_members table.
 * 
 * Security: Server-only, uses Supabase server client with RLS.
 */

'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';

export interface SiteAccessResult {
  allowed: boolean;
  role?: 'owner' | 'admin' | 'viewer' | 'editor';
  reason?: string;
}

/**
 * Validates if a user has access to a specific site.
 *
 * @param siteId - UUID of the site to check access for
 * @param userId - UUID of the user (optional, defaults to current auth user from client)
 * @param supabaseClient - Optional client with auth (e.g. Bearer). When provided, used for all queries so RLS sees the user.
 * @returns Promise with access result including role if allowed
 */
export async function validateSiteAccess(
  siteId: string,
  userId?: string,
  supabaseClient?: SupabaseClient
): Promise<SiteAccessResult> {
  try {
    const supabase = supabaseClient ?? (await createClient());

    // Get current user if userId not provided
    let currentUserId = userId;
    if (!currentUserId) {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        return {
          allowed: false,
          reason: 'not_authenticated'
        };
      }
      currentUserId = user.id;
    }

    // Check if user is admin (admins have access to all sites)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', currentUserId)
      .single();

    if (profile?.role === 'admin') {
      return {
        allowed: true,
        role: 'admin'
      };
    }

    // Check site ownership
    const { data: site } = await supabase
      .from('sites')
      .select('user_id')
      .eq('id', siteId)
      .single();

    if (!site) {
      return {
        allowed: false,
        reason: 'site_not_found'
      };
    }

    if (site.user_id === currentUserId) {
      return {
        allowed: true,
        role: 'owner'
      };
    }

    // Check site membership
    const { data: membership } = await supabase
      .from('site_members')
      .select('role')
      .eq('site_id', siteId)
      .eq('user_id', currentUserId)
      .single();

    if (membership) {
      return {
        allowed: true,
        role: membership.role as 'viewer' | 'editor' | 'owner'
      };
    }

    // Access denied - log security event
    const headersList = await headers();
    const ip = headersList.get('x-forwarded-for') || 
               headersList.get('x-real-ip') || 
               'unknown';

    console.warn('[SECURITY] Unauthorized site access attempt', {
      userId: currentUserId,
      siteId,
      ip,
      timestamp: new Date().toISOString()
    });

    return {
      allowed: false,
      reason: 'no_access'
    };

  } catch (error) {
    console.error('[SECURITY] Error validating site access:', error);
    // Fail-closed: deny access on error
    return {
      allowed: false,
      reason: 'validation_error'
    };
  }
}

/**
 * Validates site access and throws error if denied.
 * Use this in API routes where access denial should return 403.
 * 
 * @param siteId - UUID of the site to check access for
 * @param userId - Optional user ID (defaults to current auth user)
 * @throws Error if access is denied
 */
export async function requireSiteAccess(
  siteId: string,
  userId?: string
): Promise<SiteAccessResult> {
  const result = await validateSiteAccess(siteId, userId);
  
  if (!result.allowed) {
    throw new Error(`Access denied to site ${siteId}: ${result.reason}`);
  }
  
  return result;
}
