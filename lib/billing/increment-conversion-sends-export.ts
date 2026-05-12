/**
 * PR-F + ledger idempotency: debit `monthly_conversion_sends` for the exact `offline_conversion_queue`
 * rows about to be claimed for Google export. All math is in Postgres (`increment_oci_conversion_sends_v1`);
 * Node only validates UUIDs (Zod) and calls one RPC.
 *
 * SSOT: docs/architecture/BILLING_CONVERSION_SENDS_SSOT.md
 */
import { adminClient } from '@/lib/supabase/admin';
import { getEntitlements } from '@/lib/entitlements/getEntitlements';
import { getCurrentYearMonthUTC } from '@/lib/quota';
import { logWarn } from '@/lib/logging/logger';
import { ociConversionSendBillingQueueIdsSchema } from '@/lib/billing/oci-conversion-send-billing-queue-ids.zod';

export type ConversionSendsIncrementResult =
  | { ok: true; billedNew: number; billedAlready: number }
  | { ok: false; reason: 'LIMIT' | 'RPC_ERROR' | 'QUEUE_SITE_MISMATCH' | 'INVALID_INPUT' };

type RpcPayload = {
  ok?: boolean;
  reason?: string;
  billed_new?: number;
  billed_already?: number;
};

/**
 * @param queueIds — canonical queue UUID strings (no `seal_` prefix), same batch as `append_script_claim_transition_batch`.
 */
export async function incrementConversionSendsForExportClaim(
  siteIdUuid: string,
  queueIds: string[]
): Promise<ConversionSendsIncrementResult> {
  const parsed = ociConversionSendBillingQueueIdsSchema.safeParse(queueIds);
  if (!parsed.success) {
    logWarn('OCI_CONVERSION_SEND_BILLING_QUEUE_IDS_INVALID', {
      siteId: siteIdUuid,
      issues: parsed.error.flatten(),
    });
    return { ok: false, reason: 'INVALID_INPUT' };
  }

  const yearMonth = getCurrentYearMonthUTC();
  const currentMonthStart = `${yearMonth}-01`;
  const entitlements = await getEntitlements(siteIdUuid, adminClient);
  const { data: raw, error: rpcError } = await adminClient.rpc('increment_oci_conversion_sends_v1', {
    p_site_id: siteIdUuid,
    p_month: currentMonthStart,
    p_queue_ids: parsed.data,
    p_limit: entitlements.limits.monthly_conversion_sends,
  });

  if (rpcError) {
    logWarn('CONVERSION_SENDS_INCREMENT_RPC_ERROR', { siteId: siteIdUuid, message: rpcError.message });
    return { ok: false, reason: 'RPC_ERROR' };
  }

  const row = raw as RpcPayload | null;
  if (!row || typeof row !== 'object') {
    logWarn('CONVERSION_SENDS_INCREMENT_RPC_MALFORMED', { siteId: siteIdUuid });
    return { ok: false, reason: 'RPC_ERROR' };
  }

  if (row.ok === false && row.reason === 'LIMIT') {
    return { ok: false, reason: 'LIMIT' };
  }
  if (row.ok === false && row.reason === 'QUEUE_SITE_MISMATCH') {
    logWarn('OCI_CONVERSION_SEND_BILLING_QUEUE_SITE_MISMATCH', { siteId: siteIdUuid, row });
    return { ok: false, reason: 'QUEUE_SITE_MISMATCH' };
  }
  if (row.ok === false) {
    logWarn('CONVERSION_SENDS_INCREMENT_RPC_REJECT', { siteId: siteIdUuid, row });
    return { ok: false, reason: 'RPC_ERROR' };
  }

  return {
    ok: true,
    billedNew: Number(row.billed_new ?? 0),
    billedAlready: Number(row.billed_already ?? 0),
  };
}
