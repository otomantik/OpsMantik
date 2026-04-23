export function resolveLandingRoute(params: { isAdmin: boolean; siteCount: number }): '/dashboard' | '/panel' {
  if (params.isAdmin) return '/dashboard';
  if (params.siteCount > 0) return '/panel';
  return '/dashboard';
}
