/**
 * Call-event worker payload: pre-validated data from receiver (HMAC, replay, consent passed).
 * Worker performs insert + audit only.
 */

export type CallEventWorkerPayload = {
  _ingest_type: 'call-event';
  site_id: string;
  phone_number: string | null;
  matched_session_id: string;
  matched_fingerprint: string;
  lead_score: number;
  lead_score_at_match: number | null;
  score_breakdown: Record<string, unknown> | null;
  confidence_score: number | null;
  matched_at: string;
  status: string | null;
  source: 'click';
  intent_action: string;
  intent_target: string;
  intent_stamp: string;
  intent_page_url: string | null;
  click_id: string | null;
  signature_hash: string | null;
  event_id?: string | null;
  _client_value?: number | null;
};

export function isCallEventWorkerPayload(raw: unknown): raw is CallEventWorkerPayload {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return o._ingest_type === 'call-event' && typeof o.site_id === 'string' && typeof o.matched_session_id === 'string';
}
