/**
 * Post-login landing: site list / setup shell. Operators open a site via
 * `/panel?siteId=…`; platform admins use Komuta Merkezi or panel-preview.
 */
export function resolveLandingRoute(_params: {
  isAdmin: boolean;
  siteCount: number;
}): "/dashboard" {
  return "/dashboard";
}
