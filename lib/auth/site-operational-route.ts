/**
 * Site operators (owners, invited customers) use `/panel` (Odak Akışı).
 * Platform admins use `/dashboard/site/...` (Komuta Merkezi) or panel-preview.
 */
export function panelSitePath(siteId: string): string {
  const q = new URLSearchParams({ siteId });
  return `/panel?${q.toString()}`;
}

export function panelOciPath(siteId: string): string {
  const q = new URLSearchParams({ siteId });
  return `/panel/oci?${q.toString()}`;
}
