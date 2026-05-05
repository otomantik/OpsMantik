/**
 * Map ConversionJob + credentials -> ClickConversionRequest[] for uploadClickConversions.
 * PR-G3: Canonical payload (conversion_time, value_cents, currency, click_ids, order_id) -> Google format.
 * Abyss Protocol: OMEGA-1/2 click & hashed_phone; OMEGA-3 cryptographic order_id; OMEGA-4 Object.freeze.
 */

import { createHash } from 'node:crypto';
import { minorToMajor } from '@/lib/i18n/currency';
import type { ConversionJob } from '../types';
import type { GoogleAdsCredentials, ClickConversionRequest } from './types';

const HASHED_PHONE_LENGTH = 64;
const HASHED_PHONE_HEX_REGEX = /^[a-f0-9]{64}$/i;

/** Google Ads order_id max 55 chars (API); we use 50 for safety and collision resistance via hash. */
const ORDER_ID_MAX_LENGTH = 50;

/** conversion_date_time format: "yyyy-mm-dd hh:mm:ss+|-hh:mm" (no milliseconds; e.g. "2024-01-15 12:30:00+00:00"). */
function toConversionDateTime(isoOrUnknown: unknown): string {
  if (typeof isoOrUnknown !== 'string') {
    throw new Error('INVALID_CONVERSION_TIME');
  }
  const d = new Date(isoOrUnknown);
  if (Number.isNaN(d.getTime())) throw new Error('INVALID_CONVERSION_TIME');
  return d.toISOString().slice(0, 19).replace('T', ' ') + '+00:00';
}

/**
 * Normalize click ID for Google Ads API. GCLID/wbraid/gbraid are base64-encoded; when captured from
 * URLs they may be stored as base64url (RFC 4648: _ and -). Google expects standard base64 (+ and /).
 */
function normalizeClickIdForGoogle(clickId: string): string {
  return clickId.replace(/-/g, '+').replace(/_/g, '/');
}

type ClickIdType = 'gclid' | 'wbraid' | 'gbraid';

/**
 * OMEGA-1: Extract single click identifier with strict validation. No implicit coercion.
 * Precedence: gclid > wbraid > gbraid. Call only when at least one raw value is non-empty.
 */
function getClickIdStrict(clickIds: { gclid?: string | null; wbraid?: string | null; gbraid?: string | null }): { clickId: string; idType: ClickIdType } | null {
  const rawGclid = clickIds.gclid != null ? String(clickIds.gclid).trim() : '';
  const rawWbraid = clickIds.wbraid != null ? String(clickIds.wbraid).trim() : '';
  const rawGbraid = clickIds.gbraid != null ? String(clickIds.gbraid).trim() : '';

  const clickId = rawGclid || rawWbraid || rawGbraid;
  if (!clickId || clickId === 'undefined' || clickId === 'null') {
    return null;
  }
  const idType: ClickIdType = rawGclid ? 'gclid' : rawWbraid ? 'wbraid' : 'gbraid';
  return { clickId, idType };
}

/**
 * OMEGA-2: Assert hashed_phone_number is exactly 64-char hex. Idempotent: accept existing hash.
 */
function validateHashedPhone(raw: string | null | undefined): string | undefined {
  if (raw == null || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length !== HASHED_PHONE_LENGTH || !HASHED_PHONE_HEX_REGEX.test(trimmed)) {
    throw new Error(`ABYSS_ERR: Invalid hashed_phone_number length or format (expected ${HASHED_PHONE_LENGTH} hex chars)`);
  }
  return trimmed.toLowerCase();
}

/**
 * Build one ClickConversionRequest from a job. Uses conversion_action from credentials.
 * Exactly one of gclid, wbraid, gbraid must be set for Google to accept.
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
    hashed_phone_number?: string | null;
  } | undefined;

  const clickIds = payload?.click_ids ?? job.click_ids ?? {};
  const strict = getClickIdStrict(clickIds);
  if (!strict) return null;

  const { clickId, idType } = strict;
  const conversionTime = payload?.conversion_time ?? job.occurred_at;
  const conversionDateTime = toConversionDateTime(conversionTime);
  const valueCents = typeof payload?.value_cents === 'number' ? payload.value_cents : job.amount_cents;
  if (typeof valueCents !== 'number' || !Number.isFinite(valueCents) || valueCents <= 0) {
    throw new Error('INVALID_VALUE_CENTS');
  }
  const currency = String(payload?.currency ?? job.currency ?? 'USD').slice(0, 3);

  // OMEGA-3: Cryptographic deduplication. Never pass raw long string (e.g. GCLID_action_date) — Google limit 55.
  const actionStr = String(job.action_key ?? job.id).trim() || job.id;
  const dedupeSeed = `${clickId}_${actionStr}_${conversionDateTime}`;
  const secureOrderId = createHash('sha256').update(dedupeSeed, 'utf8').digest('hex').substring(0, ORDER_ID_MAX_LENGTH);

  const req: ClickConversionRequest = {
    conversion_action: conversionActionResourceName,
    conversion_date_time: conversionDateTime,
    conversion_value: minorToMajor(valueCents, currency),
    currency_code: currency,
    order_id: secureOrderId,
  };

  req[idType] = normalizeClickIdForGoogle(clickId);

  const hashedPhone = validateHashedPhone(payload?.hashed_phone_number);
  if (hashedPhone) {
    req.user_identifiers = [{ hashed_phone_number: hashedPhone }];
  }

  // OMEGA-4: Seal payload against downstream mutation.
  Object.freeze(req);
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
