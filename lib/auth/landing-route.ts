export function resolveLandingRoute(params: { isAdmin: boolean; siteCount: number }): '/dashboard' | '/panel' {
  // Super admins should land on dashboard site list.
  if (params.isAdmin) return '/dashboard';
  if (params.siteCount > 0) return '/panel';
  return '/dashboard';
}
