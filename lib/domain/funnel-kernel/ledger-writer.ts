/**
 * Funnel Kernel Ledger Writer
 * Append-only event append to call_funnel_ledger.
 * See: docs/architecture/FUNNEL_CONTRACT.md, PROJECTION_REDUCER_SPEC.md
 */

import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';

export type FunnelEventType =
  | 'V2_CONTACT'
  | 'V2_SYNTHETIC'
  | 'V3_QUALIFIED'
  | 'V4_INTENT'
  | 'V5_SEALED'
  | 'REPAIR_ATTEMPTED'
  | 'REPAIR_COMPLETED'
  | 'REPAIR_FAILED';

export type FunnelEventSource =
  | 'TRACK'
  | 'SYNC'
  | 'CALL_EVENT'
  | 'OUTBOX_CRON'
  | 'SEAL_ROUTE'
  | 'WORKER'
  | 'REPAIR'
  | 'PROBE';

export interface AppendFunnelEventInput {
  callId: string;
  siteId: string;
  eventType: FunnelEventType;
  eventSource: FunnelEventSource;
  idempotencyKey: string;
  occurredAt: Date;
  payload?: Record<string, unknown>;
  causationId?: string | null;
  correlationId?: string | null;
}

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Append a funnel event to call_funnel_ledger.
 * Tenant validation: call_id must belong to site_id. If not, throws.
 * Idempotent: duplicate idempotency_key returns { appended: false } (silent skip).
 */
export async function appendFunnelEvent(input: AppendFunnelEventInput): Promise<{ appended: boolean }> {
  const { callId, siteId, eventType, eventSource, idempotencyKey, occurredAt, payload, causationId, correlationId } =
    input;

  // Tenant validation: call must belong to site
  const { data: callRow, error: callErr } = await adminClient
    .from('calls')
    .select('site_id')
    .eq('id', callId)
    .single();

  if (callErr || !callRow) {
    throw new Error(`appendFunnelEvent: call ${callId} not found`);
  }
  if (callRow.site_id !== siteId) {
    throw new Error(`appendFunnelEvent: tenant mismatch — call ${callId} belongs to different site`);
  }

  const { error } = await adminClient.from('call_funnel_ledger').insert({
    call_id: callId,
    site_id: siteId,
    event_type: eventType,
    event_family: 'FUNNEL',
    event_source: eventSource,
    idempotency_key: idempotencyKey,
    occurred_at: occurredAt.toISOString(),
    payload: payload ?? {},
    causation_id: causationId ?? null,
    correlation_id: correlationId ?? null,
  });

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      // Idempotent skip
      return { appended: false };
    }
    logWarn('appendFunnelEvent failed', { callId, siteId, idempotencyKey, error: error.message });
    throw error;
  }

  return { appended: true };
}
