import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth/is-admin';

/**
 * Server-side guard for admin-only API routes.
 * Use at the start of a route handler:
 *
 *   const forbidden = await requireAdmin();
 *   if (forbidden) return forbidden;
 *
 * Enforcement points for /admin:
 * - Middleware (lib/supabase/middleware.ts): /admin/* pages require profile.role = 'admin'; else redirect to /dashboard.
 * - Admin pages (e.g. app/admin/sites/page.tsx): isAdmin() then redirect to /dashboard.
 * - Admin APIs (e.g. /api/sync/dlq/*, /api/stats/reconcile): requireAdmin() or isAdmin() then 403.
 * - DB: admin_sites_list and other admin RPCs use is_admin(auth.uid()) or profiles.role check in SQL.
 */

/** Returns 403 response when allowed is false; null when allowed. Used by requireAdmin and by tests. */
export function requireAdminResponse(allowed: boolean): NextResponse | null {
  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

export async function requireAdmin(): Promise<NextResponse | null> {
  return requireAdminResponse(await isAdmin());
}
