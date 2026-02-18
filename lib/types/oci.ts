/**
 * Types for OCI export API (site, calls, sessions).
 * Used by /api/oci/export.
 */

/** Site row with currency for OCI CSV. */
export interface SiteWithCurrency {
  id: string;
  currency?: string | null;
}

/** Call row from calls table for OCI export. */
export interface OciCallRow {
  id: string;
  created_at: string;
  confirmed_at?: string | null;
  matched_session_id?: string | null;
  click_id?: string | null;
  oci_status?: string | null;
}

/** Session row for click-id lookup (gclid, wbraid, gbraid). */
export interface OciSessionRow {
  id: string;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
}
