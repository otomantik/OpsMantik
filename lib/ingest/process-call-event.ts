/**
 * Process call-event worker payload: insert call + audit.
 * Pre-condition: HMAC, replay, consent already validated in receiver.
 * HOTFIX: calls_status_check only allows ['intent','confirmed','junk','qualified','real','cancelled'] or NULL.
 * Click-origin leads must therefore enter the canonical intent ontology immediately.
 */

import { createTenantClient } from '@/lib/supabase/tenant-client';
import { logError, logWarn } from '@/lib/logging/logger';
import { publishToQStash } from '@/lib/ingest/publish';
import { upsertSessionGeo } from '@/lib/geo/upsert-session-geo';
import { getPrimarySource } from '@/lib/conversation/primary-source';
import { evaluateAndRouteSignal } from '@/lib/domain/mizan-mantik';
import { appendFunnelEvent } from '@/lib/domain/funnel-kernel/ledger-writer';
import { deriveCallEventAuthoritativePaidOrganic } from '@/lib/domain/deterministic-engine/call-event-authoritative-source';
import { runCallEventPaidSurfaceParity } from '@/lib/domain/deterministic-engine/parity-call-event';
import { appendCanonicalTruthLedgerBestEffort } from '@/lib/domain/truth/canonical-truth-ledger-writer';
import { appendTruthEvidenceLedgerBestEffort } from '@/lib/domain/truth/truth-evidence-ledger-writer';
import { probeFunnelProjectionDualRead } from '@/lib/domain/truth/projection-dual-read';
import { resolveIntentConversation } from '@/lib/services/conversation-service';
import { sanitizeClickId } from '@/lib/attribution';

// Brain Score logic moved to async worker

import { insertCallScoreAudit } from '@/lib/scoring/call-scores-audit';

/** DIC: Derive phone_source_type for Trust Score (form_fill | click_to_call | manual_dial). */
function derivePhoneSourceType(payload: CallEventWorkerPayload): string | null {
  if (payload.source === 'click' && (payload.intent_action === 'phone' || payload.intent_action === 'whatsapp')) {
    return 'click_to_call';
  }
  return null;
}
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
  const sanitizedClickId = sanitizeClickId(payload.click_id) ?? null;
  const sanitizedGclid = sanitizeClickId(payload.gclid) ?? sanitizedClickId;
  const sanitizedWbraid = sanitizeClickId(payload.wbraid) ?? null;
  const sanitizedGbraid = sanitizeClickId(payload.gbraid) ?? null;

  // ── GCLID-first geo: prefer AdsContext over IP-derived (Rome/Amsterdam vs Istanbul) ────────────
  const adsCtx = payload.ads_context ?? null;
  let resolvedDistrictName: string | null = null;
  let locationSource: 'gclid' | null = null;
  let adsCity: string | null = null;

  if (adsCtx?.geo_target_id) {
    try {
      const { data: geoRow } = await tenantClient
        .from('google_geo_targets')
        .select('canonical_name')
        .eq('criteria_id', adsCtx.geo_target_id)
        .single();

      if (geoRow?.canonical_name) {
        // canonical_name format: "Şişli,İstanbul,Turkey" → district "Şişli / İstanbul", city "İstanbul"
        const parts = geoRow.canonical_name.split(',').map((p: string) => p.trim());
        resolvedDistrictName = parts.length >= 2 ? `${parts[0]} / ${parts[1]}` : parts[0] || null;
        adsCity = parts.length >= 2 ? parts[1] : null;
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

  // Early-call fix 1: session lacks GCLID; payload has gclid/wbraid/gbraid → persist to session for OCI
  const sessionMonth = payload.matched_session_month ?? (payload.matched_at ? new Date(payload.matched_at).toISOString().slice(0, 7) + '-01' : null);
  const payloadHasClickIds = Boolean(
    sanitizedGclid ||
    sanitizedWbraid ||
    sanitizedGbraid
  );
  if (payload.matched_session_id && sessionMonth && payloadHasClickIds) {
    try {
      const { data: sessionRow } = await tenantClient
        .from('sessions')
        .select('gclid, wbraid, gbraid')
        .eq('id', payload.matched_session_id)
        .eq('site_id', siteId)
        .eq('created_month', sessionMonth)
        .maybeSingle();
      const sess = sessionRow as { gclid?: string | null; wbraid?: string | null; gbraid?: string | null } | null;
      const sessionHasClickIds = Boolean(
        sess && ((sess.gclid && String(sess.gclid).trim()) || (sess.wbraid && String(sess.wbraid).trim()) || (sess.gbraid && String(sess.gbraid).trim()))
      );
      if (!sessionHasClickIds) {
        await tenantClient
          .from('sessions')
          .update({
            gclid: sanitizedGclid,
            wbraid: sanitizedWbraid,
            gbraid: sanitizedGbraid,
          })
          .eq('id', payload.matched_session_id)
          .eq('site_id', siteId)
          .eq('created_month', sessionMonth);
      }
    } catch {
      // Non-critical; ingestion continues
    }
  }

  // Early-call fix 2: session lacks ADS geo; payload has ads_context.geo_target_id → upsert ADS geo to session
  if (payload.matched_session_id && sessionMonth && resolvedDistrictName && locationSource === 'gclid') {
    try {
      await upsertSessionGeo({
        siteId,
        sessionId: payload.matched_session_id,
        sessionMonth,
        city: adsCity,
        district: resolvedDistrictName,
        source: 'ADS',
      });
    } catch {
      // Non-critical; ingestion continues
    }
  }

  // ── ARCHITECTURAL HARDENING: Async Scoring ──────────────────────
  // Click-origin leads enter the existing queue ontology as intent immediately.
  // Async scoring may later fast-track them to qualified, but must never create a
  // status family that the DB state machine, queue UI, or cleanup jobs do not own.
  const initialStatus = 'intent';

  const authoritativeCallEventSourceType = deriveCallEventAuthoritativePaidOrganic({
    sanitizedGclid,
    sanitizedWbraid,
    sanitizedGbraid,
    sanitizedClickId,
  });

  const baseInsert: Record<string, unknown> = {
    site_id: siteId,
    phone_number: payload.phone_number,
    matched_session_id: payload.matched_session_id,
    matched_fingerprint: payload.matched_fingerprint,
    ...(sessionMonth ? { session_created_month: sessionMonth } : {}),
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
    click_id: sanitizedClickId,
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
    gclid: sanitizedGclid,
    wbraid: sanitizedWbraid,
    gbraid: sanitizedGbraid,
    source_type: authoritativeCallEventSourceType,
    // DIC: user_agent for ECL / device entropy; phone_source_type for Trust Score
    ...(payload.ua != null && String(payload.ua).trim() !== '' ? { user_agent: String(payload.ua).trim() } : {}),
    ...(derivePhoneSourceType(payload) ? { phone_source_type: derivePhoneSourceType(payload) } : {}),
  };

  const insertWithEventId = payload.event_id
    ? { ...baseInsert, event_id: payload.event_id }
    : baseInsert;

  let insertPayload: Record<string, unknown> = payload.event_id ? insertWithEventId : baseInsert;
  const strippedCols = new Set<string>();
  let callRecord: { id: string; created_at?: string } | null = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error: insertError, data: rData } = await tenantClient
      .from('calls')
      .insert({ ...insertPayload }) // TenantClient automatically adds site_id filter
      .select('id, created_at')
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

  runCallEventPaidSurfaceParity({
    siteId,
    intentPageUrl: payload.intent_page_url,
    sanitizedGclid,
    sanitizedWbraid,
    sanitizedGbraid,
    sanitizedClickId,
  });

  await appendTruthEvidenceLedgerBestEffort({
    siteId,
    evidenceKind: 'CALL_EVENT_CALL_INSERTED',
    ingestSource: 'CALL_EVENT',
    idempotencyKey: `truth:call_event:${callRecord.id}`,
    occurredAt: new Date(callRecord.created_at ?? Date.now()),
    sessionId: payload.matched_session_id ?? null,
    callId: callRecord.id,
    correlationId: requestId ?? null,
    payload: {
      schema: 'phase1.call_event.v1',
      call_id: callRecord.id,
      event_id: payload.event_id ?? null,
      has_phone: Boolean(payload.phone_number && String(payload.phone_number).trim()),
      source_type: authoritativeCallEventSourceType,
      intent_action: payload.intent_action ?? null,
    },
  });

  await appendCanonicalTruthLedgerBestEffort({
    siteId,
    streamKind: 'INGEST_CALL_EVENT',
    idempotencyKey: `canonical:ingest_call_event:insert:${callRecord.id}`,
    occurredAt: new Date(callRecord.created_at ?? Date.now()),
    sessionId: payload.matched_session_id ?? null,
    callId: callRecord.id,
    correlationId: requestId ?? null,
    payload: {
      v: 1,
      refs: {
        call_id: callRecord.id,
        session_id: payload.matched_session_id ?? null,
        event_id: payload.event_id ?? null,
      },
      class: {
        intent_action: payload.intent_action ?? null,
        source_type: authoritativeCallEventSourceType,
      },
      has_phone: Boolean(payload.phone_number && String(payload.phone_number).trim()),
    },
  });

  const primary = await getPrimarySource(siteId, { callId: callRecord.id });
  await resolveIntentConversation({
    siteId,
    source: 'call_event',
    intentAction: payload.intent_action,
    intentTarget: payload.intent_target,
    primaryCallId: callRecord.id,
    primarySessionId: payload.matched_session_id,
    mizanValue: payload.lead_score,
    pageUrl: payload.intent_page_url,
    clickId: sanitizedClickId,
    primarySource: primary,
    idempotencyKey: `call_event:${payload.event_id ?? payload.signature_hash ?? callRecord.id}`,
  });

  // ── PR-OCI-2: V2 "İlk Temas" signal (best-effort, does not block ingestion)
  try {
    const callCreatedAt = callRecord.created_at ?? new Date().toISOString();
    const signalDate = new Date(callCreatedAt);
    const v2Result = await evaluateAndRouteSignal('V2_PULSE', {
      siteId,
      callId: callRecord.id,
      gclid: primary?.gclid ?? null,
      wbraid: primary?.wbraid ?? null,
      gbraid: primary?.gbraid ?? null,
      aov: 0,
      clickDate: signalDate,
      signalDate,
      clientIp: payload.clientIp,
      traceId: requestId ?? null,
    });
    if (v2Result?.routed) {
      try {
        await appendFunnelEvent({
          callId: callRecord.id,
          siteId,
          eventType: 'V2_CONTACT',
          eventSource: 'CALL_EVENT',
          idempotencyKey: `v2:call:${callRecord.id}:source:call_event`,
          occurredAt: signalDate,
          payload: { gclid: primary?.gclid ?? null },
          correlationId: requestId ?? undefined,
        });
        void probeFunnelProjectionDualRead(siteId, callRecord.id, 'call_event');
      } catch (ledgerErr) {
        logWarn('FUNNEL_LEDGER_V2_APPEND_FAILED', { call_id: callRecord.id, error: (ledgerErr as Error)?.message });
      }
    }
  } catch (v2Err) {
    logWarn('V2_PULSE_EMIT_FAILED', { error: (v2Err as Error)?.message ?? String(v2Err) });
  }

  // ── STEP 2: Trigger Async Scoring via QStash ──────────────────────────────
  const shadowSessionQualityV1_1 = {
    final_score:
      typeof payload.lead_score === 'number' && Number.isFinite(payload.lead_score)
        ? payload.lead_score
        : null,
    confidence_score:
      payload.confidence_score != null &&
      typeof payload.confidence_score === 'number' &&
      Number.isFinite(payload.confidence_score)
        ? payload.confidence_score
        : null,
  };
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
        shadow_session_quality_v1_1: shadowSessionQualityV1_1,
      },
      deduplicationId: `score-${callRecord.id}`,
    });
  } catch (qError) {
    logWarn('ASYNC_SCORING_PUBLISH_FAILED', { error: (qError as Error)?.message ?? String(qError) });
    // Non-critical for ingestion, but the lead remains in canonical intent state.
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
