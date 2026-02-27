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

import { calculateBrainScore } from './scoring-engine';

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
  // eventIdColumnOk logic removed here, handled by payload.event_id directly

  // const safeStatus = sanitizeCallStatus(payload.status); // Removed (replaced by initialStatus)

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

  // ── Brain Score V1: Algorithmic Lead Quality ──────────────────────────────
  const { score: brainScore, breakdown: brainBreakdown } = calculateBrainScore(
    {
      ua: payload.ua,
      intent_action: payload.intent_action,
    },
    payload.ads_context
  );

  // ── ARCHITECTURAL STRATEGY: Lane Routing (Fast-Track) ──────────────────────
  // If score >= 80, auto-transition to 'qualified' and mark as fast-tracked.
  // if score < 30, it stays 'pending' but is held for review.
  const isFastTrack = brainScore >= 80;
  const initialStatus = isFastTrack ? 'qualified' : (sanitizeCallStatus(payload.status) || 'pending');

  const baseInsert: Record<string, unknown> = {
    site_id: payload.site_id,
    phone_number: payload.phone_number,
    matched_session_id: payload.matched_session_id,
    matched_fingerprint: payload.matched_fingerprint,
    lead_score: brainScore,
    lead_score_at_match: brainScore,
    score_breakdown: brainBreakdown,
    confidence_score: payload.confidence_score,
    matched_at: payload.matched_at,
    status: initialStatus,
    is_fast_tracked: isFastTrack,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
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
    ...(adsCtx?.campaign_id ? { campaign_id: adsCtx.campaign_id } : {}),
    ...(adsCtx?.adgroup_id ? { adgroup_id: adsCtx.adgroup_id } : {}),
    ...(adsCtx?.creative_id ? { creative_id: adsCtx.creative_id } : {}),
    ...(adsCtx?.network ? { network: adsCtx.network } : {}),
    ...(adsCtx?.device ? { device: adsCtx.device } : {}),
    ...(adsCtx?.placement ? { placement: adsCtx.placement } : {}),
    ...(adsCtx?.target_id ? { target_id: adsCtx.target_id } : {}),
    ...(resolvedDistrictName ? { district_name: resolvedDistrictName } : {}),
    // AdTech Metadata
    gclid: payload.gclid || payload.click_id, // Backward compatibility: click_id was often gclid
    wbraid: payload.wbraid || null,
    gbraid: payload.gbraid || null,
    source_type: (payload.gclid || payload.wbraid || payload.gbraid || payload.click_id) ? 'paid' : 'organic',
  };

  const insertWithEventId = payload.event_id
    ? { ...baseInsert, event_id: payload.event_id }
    : baseInsert;

  let insertPayload: Record<string, unknown> = payload.event_id ? insertWithEventId : baseInsert;
  const strippedCols = new Set<string>();
  let callRecord: { id: string } | null = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error: insertError, data: rData } = await adminClient
      .from('calls')
      .insert({ ...insertPayload, site_id: payload.site_id })
      .select('id')
      .single();
    callRecord = rData;

    if (!insertError) break;

    if (isMissingEventIdColumnError(insertError)) {
      // Mark as failed column for this attempt
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

  // ── ARCHITECTURAL STRATEGY: Fast-Track OCI Push ──────────────────────────
  if (isFastTrack) {
    try {
      const { enqueueSealConversion } = await import('@/lib/oci/enqueue-seal-conversion');
      await enqueueSealConversion({
        callId: callRecord.id,
        siteId: payload.site_id,
        confirmedAt: new Date().toISOString(),
        saleAmount: payload._client_value ?? null,
        currency: 'TRY', // Default currency, will be overridden by site config in utility
        leadScore: brainScore,
      });
    } catch (ociError) {
      // Fast-track push failure is non-critical for the ingestion flow
      console.warn('[FAST-TRACK] OCI Auto-Queue failed:', ociError);
    }
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
