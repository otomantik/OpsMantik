/**
 * Process call-event worker payload: insert call + audit.
 * Pre-condition: HMAC, replay, consent already validated in receiver.
 * HOTFIX: calls_status_check only allows ['intent','confirmed','junk','qualified','real','cancelled'] or NULL.
 * deriveCallStatus returns 'suspicious' which is invalid — sanitize to 'intent'.
 */

import { createTenantClient } from '@/lib/supabase/tenant-client';
import { publishToQStash } from '@/lib/ingest/publish';

// Brain Score logic moved to async worker

import { insertCallScoreAudit } from '@/lib/scoring/call-scores-audit';
import { isMissingEventIdColumnError } from '@/lib/api/call-event/shared';
import {
  extractMissingColumnName,
  stripColumnFromInsertPayload,
} from '@/lib/api/call-event/schema-drift';
import type { CallEventWorkerPayload } from './call-event-worker-payload';

// import { calculateBrainScore } from './scoring-engine'; // DECOUPLED: Moved to async worker

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
  const siteId = payload.site_id;
  const tenantClient = createTenantClient(siteId);

  // ── GCLID-first geo: prefer AdsContext over IP-derived (Rome/Amsterdam vs Istanbul) ────────────
  const adsCtx = payload.ads_context ?? null;
  let resolvedDistrictName: string | null = null;
  let locationSource: 'gclid' | null = null;

  if (adsCtx?.geo_target_id) {
    try {
      const { data: geoRow } = await tenantClient
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
        if (resolvedDistrictName) locationSource = 'gclid';
      }
    } catch {
      // Geo lookup failure is non-critical — fall back to location_name if present
    }
  }
  // If no geo_target_id resolution, use location_name from Google Ads when present
  if (!resolvedDistrictName && adsCtx?.location_name && String(adsCtx.location_name).trim()) {
    resolvedDistrictName = String(adsCtx.location_name).trim();
    locationSource = 'gclid';
  }

  // ── ARCHITECTURAL HARDENING: Async Scoring ──────────────────────
  // We no longer calculate brain score in-line. 
  // Status is set to 'pending_score' to allow instant ingestion.
  // The 'Fast-Track' logic will move to the calc-brain-score worker.
  const initialStatus = 'pending_score';

  const baseInsert: Record<string, unknown> = {
    site_id: siteId,
    phone_number: payload.phone_number,
    matched_session_id: payload.matched_session_id,
    matched_fingerprint: payload.matched_fingerprint,
    // Scoring will update these later
    lead_score: 0,
    lead_score_at_match: 0,
    score_breakdown: null,
    confidence_score: payload.confidence_score,
    matched_at: payload.matched_at,
    status: initialStatus,
    is_fast_tracked: false,
    // expires_at: omitted to let DB trigger handle NOW() + 7 days
    source: payload.source,
    intent_action: payload.intent_action,
    intent_target: payload.intent_target,
    intent_stamp: payload.intent_stamp,
    intent_page_url: payload.intent_page_url,
    click_id: payload.click_id,
    ...(payload._client_value != null ? { _client_value: payload._client_value } : {}),
    ...(payload.signature_hash ? { signature_hash: payload.signature_hash } : {}),
    // Google Ads enrichment
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
    ...(locationSource ? { location_source: locationSource } : {}),
    // AdTech Metadata
    gclid: payload.gclid || payload.click_id,
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
    const { error: insertError, data: rData } = await tenantClient
      .from('calls')
      .insert({ ...insertPayload }) // TenantClient automatically adds site_id filter
      .select('id')
      .single();
    callRecord = rData;

    if (!insertError) break;

    if (isMissingEventIdColumnError(insertError)) {
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

  // ── STEP 2: Trigger Async Scoring via QStash ──────────────────────────────
  try {
    const workerUrl = `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/workers/calc-brain-score`;
    await publishToQStash({
      url: workerUrl,
      body: {
        _ingest_type: 'calc-brain-score',
        site_id: siteId,
        call_id: callRecord.id,
        payload: {
          ua: payload.ua,
          intent_action: payload.intent_action,
        },
        ads_context: payload.ads_context,
      },
      deduplicationId: `score-${callRecord.id}`,
    });
  } catch (qError) {
    console.error('[HARDENING] Failed to trigger async scoring:', qError);
    // Non-critical for ingestion, but will leave lead as 'pending_score'
  }

  if (
    payload.score_breakdown &&
    (payload.score_breakdown as Record<string, unknown>).version === 'v1.1'
  ) {
    await insertCallScoreAudit(tenantClient, {
      siteId: payload.site_id,
      callId: callRecord.id,
      scoreBreakdown: payload.score_breakdown,
    }, { request_id: requestId, route: 'workers_ingest' });
  }

  return { success: true, call_id: callRecord.id };
}
