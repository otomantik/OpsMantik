/**
 * Post-login landing (SEAL-03).
 * - Platform admins → `/dashboard` (site list / Komuta Merkezi).
 * - Site operators → `/panel` (Odak Akışı; site resolved on panel page).
 */
export type LandingRoute = '/dashboard' | '/panel';

export function resolveLandingRoute(params: {
  isAdmin: boolean;
  siteCount: number;
}): LandingRoute {
  if (params.isAdmin) return '/dashboard';
  if (params.siteCount > 0) return '/panel';
  return '/dashboard';
}
