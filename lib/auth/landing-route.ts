export function resolveLandingRoute(params: { isAdmin: boolean; siteCount: number }): '/dashboard' | '/panel' {
  // Product decision: all authenticated users (including admins) use simple panel
  // as the default landing when at least one site exists.
  if (params.siteCount > 0) return '/panel';
  return '/dashboard';
}
