/**
 * Process call-event worker payload: insert call + audit.
 * Pre-condition: HMAC, replay, consent already validated in receiver.
 * HOTFIX: calls_status_check only allows ['intent','confirmed','junk','qualified','real','cancelled'] or NULL.
 * Click-origin leads must therefore enter the canonical intent ontology immediately.
 */

import { createTenantClient } from '@/lib/supabase/tenant-client';
import { logWarn } from '@/lib/logging/logger';
import { publishToQStash } from '@/lib/ingest/publish';
import { upsertSessionGeo } from '@/lib/geo/upsert-session-geo';
import { decideGeo } from '@/lib/geo/decision-engine';
import { getPrimarySource } from '@/lib/conversation/primary-source';
import { deriveCallEventAuthoritativePaidOrganic } from '@/lib/domain/deterministic-engine/call-event-authoritative-source';
import { runCallEventPaidSurfaceParity } from '@/lib/domain/deterministic-engine/parity-call-event';
import { appendCanonicalTruthLedgerBestEffort } from '@/lib/domain/truth/canonical-truth-ledger-writer';
import { appendTruthEvidenceLedgerBestEffort } from '@/lib/domain/truth/truth-evidence-ledger-writer';
import { resolveIntentConversation } from '@/lib/services/conversation-service';
import { sanitizeClickId } from '@/lib/attribution';
import { hasValidClickId } from '@/lib/ingest/bot-referrer-gates';

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
  if (
    (payload.click_id && !sanitizedClickId) ||
    (payload.gclid && !sanitizedGclid) ||
    (payload.wbraid && !sanitizedWbraid) ||
    (payload.gbraid && !sanitizedGbraid)
  ) {
    logWarn('CLICK_ID_DROPPED_INVALID_CLICK_ID', {
      site_id: siteId,
      reason: 'invalid_click_id',
      call_event: true,
    });
  }

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
  const geoDecision = decideGeo({
    hasValidClickId: hasValidClickId({
      gclid: sanitizedGclid,
      wbraid: sanitizedWbraid,
      gbraid: sanitizedGbraid,
    }),
    adsGeo: {
      city: adsCity,
      district: resolvedDistrictName,
    },
  });

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
        city: geoDecision.city,
        district: geoDecision.district,
        source: geoDecision.source,
        reasonCode: geoDecision.reasonCode,
        confidence: geoDecision.confidence,
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

  // Authoritative single-card contract:
  // converge call-event writes onto ensure_session_intent_v1 so sync + call-event
  // share the same session-canonical upsert authority.
  const { data: ensuredCallIdRaw, error: ensureErr } = await tenantClient.rpc('ensure_session_intent_v1', {
    p_site_id: siteId,
    p_session_id: payload.matched_session_id,
    p_fingerprint: payload.matched_fingerprint,
    p_lead_score: payload.lead_score,
    p_intent_action: payload.intent_action,
    p_intent_target: payload.intent_target,
    p_intent_page_url: payload.intent_page_url,
    p_click_id: sanitizedClickId,
    p_form_state: null,
    p_form_summary: null,
  });
  if (ensureErr) {
    throw ensureErr;
  }
  const ensuredCallId = Array.isArray(ensuredCallIdRaw)
    ? (ensuredCallIdRaw[0] as string | undefined) ?? null
    : (ensuredCallIdRaw as string | null);
  if (!ensuredCallId) {
    throw new Error('ensure_session_intent_v1 returned no call id');
  }

  const enrichmentUpdate: Record<string, unknown> = {
    ...(sessionMonth ? { session_created_month: sessionMonth } : {}),
    confidence_score: payload.confidence_score,
    matched_at: payload.matched_at,
    status: initialStatus,
    is_fast_tracked: false,
    ...(payload._client_value != null ? { _client_value: payload._client_value } : {}),
    ...(payload.signature_hash ? { signature_hash: payload.signature_hash } : {}),
    ...(payload.event_id ? { event_id: payload.event_id } : {}),
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
    ...(geoDecision.district ? { district_name: geoDecision.district } : {}),
    ...(locationSource ? { location_source: locationSource } : {}),
    location_reason_code: geoDecision.reasonCode,
    location_confidence: geoDecision.confidence,
    gclid: sanitizedGclid,
    wbraid: sanitizedWbraid,
    gbraid: sanitizedGbraid,
    source_type: authoritativeCallEventSourceType,
    ...(payload.ua != null && String(payload.ua).trim() !== '' ? { user_agent: String(payload.ua).trim() } : {}),
    ...(derivePhoneSourceType(payload) ? { phone_source_type: derivePhoneSourceType(payload) } : {}),
  };

  // Null-safe enrichment: only fill fields that are currently empty to avoid
  // accidental downgrades of stronger records.
  const { data: currentCallRow } = await tenantClient
    .from('calls')
    .select('id, created_at, status, confidence_score, session_created_month, _client_value, signature_hash, event_id, keyword, match_type, device_model, geo_target_id, campaign_id, adgroup_id, creative_id, network, device, placement, target_id, district_name, location_source, location_reason_code, location_confidence, gclid, wbraid, gbraid, source_type, user_agent, phone_source_type')
    .eq('id', ensuredCallId)
    .maybeSingle();

  const safePatch: Record<string, unknown> = {};
  const currentObj = (currentCallRow as Record<string, unknown> | null) ?? null;
  for (const [key, value] of Object.entries(enrichmentUpdate)) {
    if (value == null) continue;
    const existing = currentObj?.[key];
    if (existing == null || existing === '') {
      safePatch[key] = value;
    }
  }

  if (Object.keys(safePatch).length > 0) {
    const { error: patchErr } = await tenantClient
      .from('calls')
      .update(safePatch)
      .eq('id', ensuredCallId);
    if (patchErr) {
      const missingCol = extractMissingColumnName(patchErr);
      if (missingCol) {
        // Schema-drift tolerant fallback: strip unknown field and retry once.
        delete safePatch[missingCol];
        if (Object.keys(safePatch).length > 0) {
          const { error: retryErr } = await tenantClient
            .from('calls')
            .update(safePatch)
            .eq('id', ensuredCallId);
          if (retryErr) throw retryErr;
        }
      } else if (!isMissingEventIdColumnError(patchErr)) {
        throw patchErr;
      }
    }
  }

  const callRecord = {
    id: ensuredCallId,
    created_at:
      (currentObj?.created_at as string | undefined) ?? payload.matched_at ?? new Date().toISOString(),
  };

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
