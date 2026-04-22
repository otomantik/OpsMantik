/**
 * Call-event → QStash ingest queue (Panoptic Phase 3 — application service).
 * Keeps route handlers as transport; worker payload + publish live here.
 */

import type { NextRequest } from 'next/server';
import { publishToQStash } from '@/lib/ingest/publish';
import type { ScoreBreakdown } from '@/lib/types/call-event';

export type CallEventIngestPublishVariant = 'v1_telemetry_lane' | 'v2_explicit_ingest_url';

export type BuildCallEventIngestWorkerBodyInput = {
  sitePublicId: string;
  phone_number: string | null;
  matched_session_id: string | null;
  matched_session_month: string | null;
  matched_fingerprint: string;
  lead_score: number | null;
  lead_score_at_match: number | null;
  /** Match RPC may return a loose object; worker accepts JSON-serializable breakdown. */
  score_breakdown: ScoreBreakdown | Record<string, unknown> | null;
  confidence_score: number | null;
  matched_at: string | null;
  status: string | null;
  intent_action: string;
  intent_target: string;
  intent_stamp: string;
  intent_page_url: string | null;
  click_id: string | null;
  gclid: string | null;
  wbraid: string | null;
  gbraid: string | null;
  signature_hash: string | null;
  ua: string | null;
  event_id?: string | null;
  client_value?: number | string | null;
  ads_context?: Record<string, unknown> | null;
  /** V1-only: forwarded to worker for IP lineage. */
  clientIp?: string | null;
};

export function buildCallEventIngestWorkerBody(
  input: BuildCallEventIngestWorkerBodyInput
): Record<string, unknown> {
  const {
    sitePublicId,
    phone_number,
    matched_session_id,
    matched_session_month,
    matched_fingerprint,
    lead_score,
    lead_score_at_match,
    score_breakdown,
    confidence_score,
    matched_at,
    status,
    intent_action,
    intent_target,
    intent_stamp,
    intent_page_url,
    click_id,
    gclid,
    wbraid,
    gbraid,
    signature_hash,
    ua,
    event_id,
    client_value,
    ads_context,
    clientIp,
  } = input;

  return {
    _ingest_type: 'call-event' as const,
    site_id: sitePublicId,
    phone_number,
    matched_session_id,
    matched_session_month,
    matched_fingerprint,
    lead_score,
    lead_score_at_match,
    score_breakdown,
    confidence_score,
    matched_at,
    status,
    source: 'click' as const,
    intent_action,
    intent_target,
    intent_stamp,
    intent_page_url,
    click_id,
    gclid,
    wbraid,
    gbraid,
    signature_hash,
    ua,
    ...(clientIp != null && clientIp !== '' ? { clientIp } : {}),
    ...(event_id ? { event_id } : {}),
    ...(client_value !== null && client_value !== undefined ? { _client_value: client_value } : {}),
    ...(ads_context ? { ads_context } : {}),
  };
}

export async function publishCallEventIngestWorker(args: {
  variant: CallEventIngestPublishVariant;
  req: NextRequest;
  body: Record<string, unknown>;
  deduplicationId: string;
}): Promise<void> {
  const { variant, req, body, deduplicationId } = args;
  if (variant === 'v2_explicit_ingest_url') {
    const workerUrl = `${new URL(req.url).origin}/api/workers/ingest/telemetry`;
    await publishToQStash({
      url: workerUrl,
      body,
      deduplicationId,
      retries: 3,
    });
    return;
  }
  await publishToQStash({
    lane: 'telemetry',
    body,
    deduplicationId,
    retries: 3,
  });
}
