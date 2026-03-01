/**
 * Call-event worker payload: pre-validated data from receiver (HMAC, replay, consent passed).
 * Worker performs insert + audit only.
 * Sprint 3: Single source of truth for AdsContext — Zod schema to prevent payload poisoning.
 */

import { z } from 'zod';

/** Google Ads ValueTrack enrichment context — strict Zod schema (no any). */
export const AdsContextSchema = z.object({
  keyword: z.string().max(512).nullable().optional(),
  match_type: z.string().max(8).nullable().optional(),
  network: z.string().max(16).nullable().optional(),
  device: z.string().max(16).nullable().optional(),
  device_model: z.string().max(256).nullable().optional(),
  geo_target_id: z.number().int().positive().nullable().optional(),
  /** Human-readable location from Google Ads (e.g. Istanbul). GCLID-first: prefer over IP-derived geo. */
  location_name: z.string().max(512).nullable().optional(),
  campaign_id: z.number().int().positive().nullable().optional(),
  adgroup_id: z.number().int().positive().nullable().optional(),
  creative_id: z.number().int().positive().nullable().optional(),
  placement: z.string().max(512).nullable().optional(),
  target_id: z.number().int().positive().nullable().optional(),
});
export type AdsContext = z.infer<typeof AdsContextSchema>;

/** For ingest routes: ads_context is optional and can be null. */
export const AdsContextOptionalSchema = AdsContextSchema.nullable().optional();

export type CallEventWorkerPayload = {
  _ingest_type: 'call-event';
  site_id: string;
  phone_number: string | null;
  matched_session_id: string;
  /** Session partition (YYYY-MM-01). Used for early-call ADS geo upsert. */
  matched_session_month?: string | null;
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
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  signature_hash: string | null;
  ua?: string | null;
  event_id?: string | null;
  _client_value?: number | null;
  ads_context?: AdsContext | null;
};

export function isCallEventWorkerPayload(raw: unknown): raw is CallEventWorkerPayload {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return o._ingest_type === 'call-event' && typeof o.site_id === 'string' && typeof o.matched_session_id === 'string';
}
