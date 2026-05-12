/**
 * PR-F: Debit `monthly_conversion_sends` for an OCI Google Ads export batch that will claim rows for upload.
 * Called **before** `append_script_claim_transition_batch` so a LIMIT result does not leave rows claimed
 * without a matching usage increment attempt. One increment per export batch (not per queue row).
 */
import { adminClient } from '@/lib/supabase/admin';
import { getEntitlements } from '@/lib/entitlements/getEntitlements';
import { getCurrentYearMonthUTC } from '@/lib/quota';
import { logWarn } from '@/lib/logging/logger';

export type ConversionSendsIncrementResult = { ok: true } | { ok: false; reason: 'LIMIT' | 'RPC_ERROR' };

/**
 * Increment `conversion_sends` by one for this site/month (cap enforced). Caller runs this immediately
 * before claiming queue rows for the Google-bound slice of the export response.
 */
export async function incrementConversionSendsForExportClaim(siteIdUuid: string): Promise<ConversionSendsIncrementResult> {
  const yearMonth = getCurrentYearMonthUTC();
  const currentMonthStart = `${yearMonth}-01`;
  const entitlements = await getEntitlements(siteIdUuid, adminClient);
  const { data: incResult, error: incError } = await adminClient.rpc('increment_usage_checked', {
    p_site_id: siteIdUuid,
    p_month: currentMonthStart,
    p_kind: 'conversion_sends',
    p_limit: entitlements.limits.monthly_conversion_sends,
  });
  if (incError) {
    logWarn('CONVERSION_SENDS_INCREMENT_RPC_ERROR', { siteId: siteIdUuid, message: incError.message });
    return { ok: false, reason: 'RPC_ERROR' };
  }
  const result = incResult as { ok?: boolean; reason?: string } | null;
  if (result && result.ok === false && result.reason === 'LIMIT') {
    return { ok: false, reason: 'LIMIT' };
  }
  return { ok: true };
}
