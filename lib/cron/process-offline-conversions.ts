/**
 * PR-G4: Worker helpers — backoff and queue row -> ConversionJob mapping.
 */

import type { ConversionJob } from '@/lib/providers/types';

/** Backoff: min(5m * 2^retry_count, 24h). Returns seconds. */
export function nextRetryDelaySeconds(retryCount: number): number {
  const fiveMin = 5 * 60;
  const twentyFourHours = 24 * 60 * 60;
  const delay = Math.min(fiveMin * Math.pow(2, retryCount), twentyFourHours);
  return Math.max(0, Math.floor(delay));
}

/** Queue row shape (from DB). */
export interface QueueRow {
  id: string;
  site_id: string;
  sale_id?: string;
  provider_key: string;
  payload: Record<string, unknown>;
  conversion_time: string;
  value_cents: number;
  currency: string;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  action_key?: string | null;
  retry_count?: number;
}

export function queueRowToConversionJob(row: QueueRow): ConversionJob {
  const occurredAt =
    typeof (row.payload as { conversion_time?: string })?.conversion_time === 'string'
      ? (row.payload as { conversion_time: string }).conversion_time
      : typeof row.conversion_time === 'string'
        ? row.conversion_time
        : new Date(row.conversion_time).toISOString();

  return {
    id: row.id,
    site_id: row.site_id,
    provider_key: row.provider_key,
    payload: row.payload ?? {},
    action_key: row.action_key ?? null,
    action_id: null,
    occurred_at: occurredAt,
    amount_cents: Number(row.value_cents),
    currency: row.currency ?? 'USD',
    click_ids: {
      gclid: row.gclid ?? null,
      wbraid: row.wbraid ?? null,
      gbraid: row.gbraid ?? null,
    },
  };
}
