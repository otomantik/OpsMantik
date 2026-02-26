/**
 * Sync gates: idempotency, quota, entitlements.
 * Used by /api/workers/ingest when processing sync events asynchronously.
 * Returns { ok: true } to continue, or { ok: false, reason } to ack and skip.
 */

import { adminClient } from '@/lib/supabase/admin';
import { computeIdempotencyKey, computeIdempotencyKeyV2, getServerNowMs, tryInsertIdempotencyKey, updateIdempotencyBillableFalse, setOverageOnIdempotencyRow } from '@/lib/idempotency';
import { getCurrentYearMonthUTC, getSitePlan, getUsage, evaluateQuota } from '@/lib/quota';
import { getEntitlements } from '@/lib/entitlements/getEntitlements';
import { classifyIngestBillable } from '@/lib/billing/ingest-billable';
import {
  incrementBillingIngestDuplicate,
  incrementBillingIngestRejectedQuota,
  incrementBillingIngestOverage,
} from '@/lib/billing-metrics';
import type { ValidIngestPayload } from '@/lib/types/ingest';

export type SyncGatesResult =
  | { ok: true; billable: boolean }
  | { ok: false; reason: 'duplicate' }
  | { ok: false; reason: 'quota_reject' }
  | { ok: false; reason: 'entitlements_reject' }
  | { ok: false; reason: 'idempotency_error'; error: unknown };

/**
 * Run idempotency, quota, entitlements gates. If any gate rejects, returns { ok: false }.
 * On success, returns { ok: true } and the caller can proceed with session/event/insert.
 */
export async function runSyncGates(
  payload: ValidIngestPayload,
  siteIdUuid: string
): Promise<SyncGatesResult> {
  const yearMonth = getCurrentYearMonthUTC();
  const billableDecision = classifyIngestBillable(payload);
  const idempotencyVersion = process.env.OPSMANTIK_IDEMPOTENCY_VERSION === '2' ? '2' : '1';
  const idempotencyKey =
    idempotencyVersion === '2'
      ? await computeIdempotencyKeyV2(siteIdUuid, payload, getServerNowMs())
      : await computeIdempotencyKey(siteIdUuid, payload);

  const idempotencyResult = await tryInsertIdempotencyKey(siteIdUuid, idempotencyKey, {
    billable: billableDecision.billable,
    billingReason: billableDecision.reason,
    eventCategory: payload.ec,
    eventAction: payload.ea,
    eventLabel: payload.el,
  });

  if (idempotencyResult.error && !idempotencyResult.duplicate) {
    return { ok: false, reason: 'idempotency_error', error: idempotencyResult.error };
  }

  if (idempotencyResult.duplicate) {
    if (billableDecision.billable) incrementBillingIngestDuplicate();
    return { ok: false, reason: 'duplicate' };
  }

  const idempotencyInserted = idempotencyResult.inserted;

  if (idempotencyInserted && billableDecision.billable) {
    const plan = await getSitePlan(siteIdUuid);
    const { usage } = await getUsage(siteIdUuid, yearMonth);
    const decision = evaluateQuota(plan, usage + 1);
    if (decision.reject) {
      incrementBillingIngestRejectedQuota();
      await updateIdempotencyBillableFalse(siteIdUuid, idempotencyKey, { reason: 'rejected_quota' });
      return { ok: false, reason: 'quota_reject' };
    }
    if (decision.overage) {
      await setOverageOnIdempotencyRow(siteIdUuid, idempotencyKey);
      incrementBillingIngestOverage();
    }

    const entitlements = await getEntitlements(siteIdUuid, adminClient);
    const currentMonthStart = `${yearMonth}-01`;
    const { data: incResult, error: incError } = await adminClient.rpc('increment_usage_checked', {
      p_site_id: siteIdUuid,
      p_month: currentMonthStart,
      p_kind: 'revenue_events',
      p_limit: entitlements.limits.monthly_revenue_events,
    });
    if (incError) {
      await updateIdempotencyBillableFalse(siteIdUuid, idempotencyKey, { reason: 'entitlements_increment_error' });
      return { ok: false, reason: 'entitlements_reject' };
    }
    const result = incResult as { ok?: boolean; reason?: string } | null;
    if (result && result.ok === false && result.reason === 'LIMIT') {
      incrementBillingIngestRejectedQuota();
      await updateIdempotencyBillableFalse(siteIdUuid, idempotencyKey, { reason: 'rejected_entitlements_quota' });
      return { ok: false, reason: 'entitlements_reject' };
    }
  }

  return { ok: true, billable: idempotencyInserted && billableDecision.billable };
}
