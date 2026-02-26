/**
 * Process call-event worker payload: insert call + audit.
 * Pre-condition: HMAC, replay, consent already validated in receiver.
 * HOTFIX: calls_status_check only allows ['intent','confirmed','junk','qualified','real','cancelled'] or NULL.
 * deriveCallStatus returns 'suspicious' which is invalid — sanitize to 'intent'.
 */

import { adminClient } from '@/lib/supabase/admin';

const VALID_CALL_STATUSES = ['intent', 'confirmed', 'junk', 'qualified', 'real', 'cancelled'] as const;

function sanitizeCallStatus(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim().toLowerCase();
  if (VALID_CALL_STATUSES.includes(s as (typeof VALID_CALL_STATUSES)[number])) return s;
  return 'intent';
}

import { insertCallScoreAudit } from '@/lib/scoring/call-scores-audit';
import { isMissingEventIdColumnError } from '@/lib/api/call-event/shared';
import {
  extractMissingColumnName,
  stripColumnFromInsertPayload,
} from '@/lib/api/call-event/schema-drift';
import type { CallEventWorkerPayload } from './call-event-worker-payload';

export type ProcessCallEventResult = { success: true; call_id: string };

export type CallInsertError = { code?: string; message?: string; details?: string; hint?: string };

/**
 * Insert call record and audit. Handles schema drift (missing event_id column).
 * Throws on error. Caller handles DLQ/retry.
 */
export async function processCallEvent(
  payload: CallEventWorkerPayload,
  requestId?: string
): Promise<ProcessCallEventResult> {
  let eventIdColumnOk = Boolean(payload.event_id);

  const safeStatus = sanitizeCallStatus(payload.status);

  // ── Google Ads enrichment: resolve geo_target_id → district_name ────────────
  const adsCtx = payload.ads_context ?? null;
  let resolvedDistrictName: string | null = null;

  if (adsCtx?.geo_target_id) {
    try {
      const { data: geoRow } = await adminClient
        .from('google_geo_targets')
        .select('canonical_name')
        .eq('criteria_id', adsCtx.geo_target_id)
        .single();

      if (geoRow?.canonical_name) {
        // canonical_name format: "Şişli,İstanbul,Turkey" → "Şişli / İstanbul"
        const parts = geoRow.canonical_name.split(',').map((p: string) => p.trim());
        resolvedDistrictName = parts.length >= 2
          ? `${parts[0]} / ${parts[1]}`
          : parts[0] || null;
      }
    } catch {
      // Geo lookup failure is non-critical — proceed without district_name
    }
  }

  const baseInsert: Record<string, unknown> = {
    site_id: payload.site_id,
    phone_number: payload.phone_number,
    matched_session_id: payload.matched_session_id,
    matched_fingerprint: payload.matched_fingerprint,
    lead_score: payload.lead_score,
    lead_score_at_match: payload.lead_score_at_match,
    score_breakdown: payload.score_breakdown,
    confidence_score: payload.confidence_score,
    matched_at: payload.matched_at,
    ...(safeStatus !== null ? { status: safeStatus } : {}),
    source: payload.source,
    intent_action: payload.intent_action,
    intent_target: payload.intent_target,
    intent_stamp: payload.intent_stamp,
    intent_page_url: payload.intent_page_url,
    click_id: payload.click_id,
    ...(payload._client_value != null ? { _client_value: payload._client_value } : {}),
    ...(payload.signature_hash ? { signature_hash: payload.signature_hash } : {}),
    // Google Ads enrichment (nullable — gracefully absent when no ads data)
    ...(adsCtx?.keyword ? { keyword: adsCtx.keyword } : {}),
    ...(adsCtx?.match_type ? { match_type: adsCtx.match_type } : {}),
    ...(adsCtx?.device_model ? { device_model: adsCtx.device_model } : {}),
    ...(adsCtx?.geo_target_id ? { geo_target_id: adsCtx.geo_target_id } : {}),
    ...(resolvedDistrictName ? { district_name: resolvedDistrictName } : {}),
  };

  const insertWithEventId = payload.event_id
    ? { ...baseInsert, event_id: payload.event_id }
    : baseInsert;

  let insertPayload: Record<string, unknown> = payload.event_id ? insertWithEventId : baseInsert;
  const strippedCols = new Set<string>();
  let callRecord: { id: string } | null = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const r = await adminClient
      .from('calls')
      .insert({ ...insertPayload, site_id: payload.site_id })
      .select('id')
      .single();
    callRecord = r.data;
    const insertError = r.error as CallInsertError | null;

    if (!insertError) break;

    if (isMissingEventIdColumnError(insertError)) {
      eventIdColumnOk = false;
      strippedCols.add('event_id');
      insertPayload = { ...insertPayload };
      delete (insertPayload as Record<string, unknown>).event_id;
      continue;
    }

    const missingCol = extractMissingColumnName(insertError);
    if (missingCol && !strippedCols.has(missingCol)) {
      const { next, stripped } = stripColumnFromInsertPayload(insertPayload, missingCol);
      if (stripped) {
        strippedCols.add(missingCol);
        insertPayload = next;
        continue;
      }
    }

    throw insertError;
  }

  if (!callRecord?.id) {
    throw new Error('Call insert returned no record');
  }

  if (
    payload.score_breakdown &&
    (payload.score_breakdown as Record<string, unknown>).version === 'v1.1'
  ) {
    await insertCallScoreAudit(adminClient, {
      siteId: payload.site_id,
      callId: callRecord.id,
      scoreBreakdown: payload.score_breakdown,
    }, { request_id: requestId, route: 'workers_ingest' });
  }

  return { success: true, call_id: callRecord.id };
}
