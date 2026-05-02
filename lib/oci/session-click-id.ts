import { sessionRowHasGoogleAdsClickId } from '@/lib/oci/oci-click-eligibility';

export interface SessionClickIdRow {
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
}

export function hasAnyAdsClickId(session: SessionClickIdRow): boolean {
  return sessionRowHasGoogleAdsClickId(session);
}
