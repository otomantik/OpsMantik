/**
 * OCI click-ID eligibility — mirrors `public.is_ads_session_click_id_only(sessions)`:
 * only gclid / wbraid / gbraid count (no UTM-only “ads-ish” sessions).
 * Used to avoid inserting outbox rows that the worker will always fail on missing click_id.
 */

export function trimClickId(value: string | null | undefined): string | null {
  const t = typeof value === 'string' ? value.trim() : '';
  return t.length > 0 ? t : null;
}

export function sessionRowHasGoogleAdsClickId(row: {
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
}): boolean {
  return (
    trimClickId(row.gclid) != null ||
    trimClickId(row.wbraid) != null ||
    trimClickId(row.gbraid) != null
  );
}

/** Smoke / script fixtures — never enqueue real OCI processing for these. */
const TEST_CLICK_SUBSTRINGS = ['TEST_GCLID', 'TEST_GBRAID', 'TEST_WBRAID', 'E2E_CLICK', 'SMOKE_GCLID'] as const;

export function isLikelyInternalTestClickId(row: {
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
}): boolean {
  const ids = [row.gclid, row.wbraid, row.gbraid];
  for (const raw of ids) {
    const v = trimClickId(raw);
    if (!v) continue;
    const u = v.toUpperCase();
    for (const m of TEST_CLICK_SUBSTRINGS) {
      if (u.includes(m)) return true;
    }
  }
  return false;
}
