import { adminClient } from '@/lib/supabase/admin';

export async function appendRoutingHop(params: {
  siteId: string;
  lane: string;
  unitId: string;
  fromState: string;
  toState: string;
  reasonCode: string;
  actor?: string;
  traceId?: string | null;
  correlationId?: string | null;
  idempotencyKey: string;
}): Promise<void> {
  const { error } = await adminClient.rpc('append_total_routing_hop_v1', {
    p_site_id: params.siteId,
    p_lane: params.lane,
    p_unit_id: params.unitId,
    p_from_state: params.fromState,
    p_to_state: params.toState,
    p_reason_code: params.reasonCode,
    p_actor: params.actor ?? 'system',
    p_trace_id: params.traceId ?? null,
    p_correlation_id: params.correlationId ?? null,
    p_idempotency_key: params.idempotencyKey,
  });
  if (error) throw error;
}
