/**
 * Post-login landing. All authenticated users go to `/dashboard` so we keep
 * a single shell; `/panel` remains available for deep links and admin preview.
 */
export function resolveLandingRoute(_params: {
  isAdmin: boolean;
  siteCount: number;
}): "/dashboard" {
  return "/dashboard";
}
