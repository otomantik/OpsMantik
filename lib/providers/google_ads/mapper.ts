/**
 * Map ConversionJob + credentials -> ClickConversionRequest[] for uploadClickConversions.
 * PR-G3: Canonical payload (conversion_time, value_cents, currency, click_ids, order_id) -> Google format.
 */

import type { ConversionJob } from '../types';
import type { GoogleAdsCredentials, ClickConversionRequest } from './types';

/** conversion_date_time format: "yyyy-mm-dd hh:mm:ss+|-hh:mm" (no milliseconds; e.g. "2024-01-15 12:30:00+00:00"). */
function toConversionDateTime(isoOrUnknown: unknown): string {
  const d =
    typeof isoOrUnknown === 'string'
      ? new Date(isoOrUnknown)
      : new Date();
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 19).replace('T', ' ') + '+00:00';
  }
  return d.toISOString().slice(0, 19).replace('T', ' ') + '+00:00';
}

/**
 * Build one ClickConversionRequest from a job. Uses conversion_action from credentials.
 * Exactly one of gclid, wbraid, gbraid must be set for Google to accept; if none, we still emit the object
 * (adapter can skip or API will return validation error).
 */
export function jobToClickConversion(
  job: ConversionJob,
  conversionActionResourceName: string
): ClickConversionRequest | null {
  const payload = job.payload as {
    conversion_time?: unknown;
    value_cents?: number;
    currency?: string;
    click_ids?: { gclid?: string | null; wbraid?: string | null; gbraid?: string | null };
    order_id?: string | null;
  } | undefined;
  const clickIds = payload?.click_ids ?? job.click_ids ?? {};
  const gclid = (clickIds.gclid ?? job.click_ids?.gclid)?.trim() || null;
  const wbraid = (clickIds.wbraid ?? job.click_ids?.wbraid)?.trim() || null;
  const gbraid = (clickIds.gbraid ?? job.click_ids?.gbraid)?.trim() || null;

  if (!gclid && !wbraid && !gbraid) {
    return null;
  }

  const conversionTime = payload?.conversion_time ?? job.occurred_at;
  const valueCents = typeof payload?.value_cents === 'number' ? payload.value_cents : job.amount_cents;
  const currency = (payload?.currency ?? job.currency ?? 'USD').slice(0, 3);
  const orderId = payload?.order_id ?? null;

  const req: ClickConversionRequest = {
    conversion_action: conversionActionResourceName,
    conversion_date_time: toConversionDateTime(conversionTime),
    conversion_value: valueCents / 100,
    currency_code: currency,
    order_id: orderId ?? undefined,
  };

  if (gclid) req.gclid = gclid;
  else if (wbraid) req.wbraid = wbraid;
  else if (gbraid) req.gbraid = gbraid;

  return req;
}

/**
 * Map a batch of jobs to ClickConversionRequest[]. Skips jobs without any click id (returns null for those indices).
 * Returns { conversions, jobIdByIndex } so adapter can map partial_failure errors back to job_id.
 */
export function mapJobsToClickConversions(
  jobs: ConversionJob[],
  creds: GoogleAdsCredentials
): { conversions: ClickConversionRequest[]; jobIdByIndex: string[] } {
  const conversionAction = creds.conversion_action_resource_name?.trim();
  if (!conversionAction) {
    throw new Error('Google Ads credentials must include conversion_action_resource_name');
  }
  const conversions: ClickConversionRequest[] = [];
  const jobIdByIndex: string[] = [];

  for (const job of jobs) {
    const conv = jobToClickConversion(job, conversionAction);
    if (conv) {
      conversions.push(conv);
      jobIdByIndex.push(job.id);
    }
  }

  return { conversions, jobIdByIndex };
}
