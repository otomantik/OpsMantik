/**
 * PR-G4: Worker helpers — backoff and queue row -> ConversionJob mapping.
 * Extinction Patch 4.1: Order ID uses deterministic unique suffix (buildOrderId).
 */

import { buildOrderId } from '@/lib/oci/build-order-id';
import type { ConversionJob } from '@/lib/providers/types';

/** Backoff: min(5m * 2^retry_count, 24h). Returns seconds. */
export function nextRetryDelaySeconds(retryCount: number): number {
  const fiveMin = 5 * 60;
  const twentyFourHours = 24 * 60 * 60;
  const delay = Math.min(fiveMin * Math.pow(2, retryCount), twentyFourHours);
  return Math.max(0, Math.floor(delay));
}

/** Queue row shape (from DB). action_key is legacy column name. */
export interface QueueRow {
  id: string;
  site_id: string;
  sale_id?: string | null;
  call_id?: string | null;
  provider_key: string;
  payload: Record<string, unknown>;
  conversion_time: string;
  value_cents: number;
  currency: string;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  action?: string | null;
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

  const clickId = (row.gclid || row.wbraid || row.gbraid || '').trim() || null;
  const orderId = buildOrderId('V5_SEAL', clickId, occurredAt, row.id, row.id, Number(row.value_cents) || 0);

  const payload: Record<string, unknown> = { ...(row.payload ?? {}), order_id: orderId };

  return {
    id: row.id,
    site_id: row.site_id,
    provider_key: row.provider_key,
    payload,
    action_key: row.action ?? row.action_key ?? null,
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
