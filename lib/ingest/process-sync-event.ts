/**
 * Core sync event processing: processed_signals dedup, session, event, intent.
 * Shared by /api/sync/worker and /api/workers/ingest.
 */

import { adminClient } from '@/lib/supabase/admin';
import { extractGeoInfo, isGhostGeoCity } from '@/lib/geo';
import { getSiteIngestConfig } from '@/lib/ingest/site-ingest-config';
import { hasValidClickId } from '@/lib/ingest/bot-referrer-gates';
import { normalizeLandingUrl } from '@/lib/ingest/normalize-landing-url';
import { upsertSessionGeo } from '@/lib/geo/upsert-session-geo';
import { debugLog } from '@/lib/utils';
import { logWarn } from '@/lib/logging/logger';
import { getFinalUrl, type IngestMeta } from '@/lib/types/ingest';
import type { IngestEventKind } from '@/lib/ingest/types';
import { assertNever } from '@/lib/ingest/types';
import { AttributionService } from '@/lib/services/attribution-service';
import { SessionService } from '@/lib/services/session-service';
import { EventService } from '@/lib/services/event-service';
import { IntentService } from '@/lib/services/intent-service';
import { incrementCapturedSafe } from '@/lib/sync/worker-stats';
import { getPrimarySource } from '@/lib/conversation/primary-source';
import { evaluateAndRouteSignal } from '@/lib/domain/mizan-mantik';

export type WorkerJob = Record<string, unknown> & {
  s: string;
  sid?: string;
  sm?: string;
  ec?: string;
  ea?: string;
  el?: string;
  ev?: number | string | null;
  meta?: IngestMeta;
  r?: string;
  ip?: string;
  ua?: string;
  geo_city?: string;
  geo_district?: string;
  geo_country?: string;
  geo_timezone?: string;
  geo_telco_carrier?: string;
  isp_asn?: number | string;
  is_proxy_detected?: boolean | number;
  consent_scopes?: string[];
};

/**
 * RFC 4122 UUID v5: SHA-1 of (namespace_bytes || name_bytes), with version and
 * variant bits set per spec. Uses a fixed opsmantik-specific namespace UUID so
 * the same logical input always produces the same dedup event UUID.
 *
 * Previous implementation used SHA-256 with non-standard bit manipulation and
 * discarded 50% of the hash entropy. This is the correct implementation.
 */

// Fixed namespace UUID for opsmantik dedup events (randomly generated, stable forever).
// Changing this would invalidate all existing dedup event IDs in processed_signals.
const OPSMANTIK_DEDUP_NAMESPACE = '7d9e2f1a-4c3b-5a8e-9f0d-2b1c6e4a7d8f';

function namespaceUuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function deterministicUuidFromString(input: string): Promise<string> {
  const nsBytes = namespaceUuidToBytes(OPSMANTIK_DEDUP_NAMESPACE);
  const nameBytes = new TextEncoder().encode(input);

  // Concatenate namespace bytes + name bytes for SHA-1
  const combined = new Uint8Array(nsBytes.length + nameBytes.length);
  combined.set(nsBytes, 0);
  combined.set(nameBytes, nsBytes.length);

  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-1', combined);
  const h = new Uint8Array(hashBuffer);

  // RFC 4122 §4.3: set version = 5 (top 4 bits of octet 6)
  h[6] = (h[6] & 0x0f) | 0x50;
  // RFC 4122 §4.1.1: set variant = 10xx (top 2 bits of octet 8)
  h[8] = (h[8] & 0x3f) | 0x80;

  const hex = Array.from(h.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function buildFallbackDedupFingerprint(job: WorkerJob, url: string): string {
  const meta = (job.meta ?? {}) as IngestMeta;
  const compact = {
    site_id: typeof job.s === 'string' ? job.s : '',
    client_sid: typeof job.sid === 'string' ? job.sid : '',
    session_month: typeof job.sm === 'string' ? job.sm : '',
    event_category: typeof job.ec === 'string' ? job.ec : '',
    event_action: typeof job.ea === 'string' ? job.ea : '',
    event_label: typeof job.el === 'string' ? job.el : '',
    event_value: job.ev ?? null,
    url,
    referrer: typeof job.r === 'string' ? job.r : '',
    ingest_id: typeof job.ingest_id === 'string' ? job.ingest_id : '',
    om_trace_uuid: typeof job.om_trace_uuid === 'string' ? job.om_trace_uuid : '',
    fingerprint: typeof meta.fp === 'string' ? meta.fp : '',
    gclid: typeof meta.gclid === 'string' ? meta.gclid : '',
    wbraid: typeof meta.wbraid === 'string' ? meta.wbraid : '',
    gbraid: typeof meta.gbraid === 'string' ? meta.gbraid : '',
  };
  return JSON.stringify(compact);
}

/**
 * Compute dedup event id for a job (used by worker skip path and processSyncEvent).
 */
export async function getDedupEventIdForJob(
  job: WorkerJob,
  url: string,
  qstashMessageId: string | null
): Promise<string> {
  const ingestId = typeof job.ingest_id === 'string' && job.ingest_id.trim() !== ''
    ? job.ingest_id.trim()
    : null;
  const traceId = typeof job.om_trace_uuid === 'string' && job.om_trace_uuid.trim() !== ''
    ? job.om_trace_uuid.trim()
    : null;
  const dedupInput = qstashMessageId
    ? `qstash:${qstashMessageId}`
    : ingestId
      ? `ingest:${ingestId}`
      : traceId
        ? `trace:${traceId}`
        : `fallback:${buildFallbackDedupFingerprint(job, url)}`;
  return deterministicUuidFromString(dedupInput);
}

/** Exhaustive event kind for switch; must match IngestEventKind in lib/ingest/types.ts. */
function getEventKind(event_category: string, event_action: string): IngestEventKind {
  const ec = event_category;
  const ea = event_action;
  if (ea === 'heartbeat') return 'heartbeat';
  if (ec === 'page' || ea === 'page_view') return 'page_view';
  if (ea === 'click' || ec === 'click') return 'click';
  if (ea === 'call_intent') return 'call_intent';
  return 'other';
}

export type ProcessSyncEventResult = { success: true; score: number };

/**
 * Process a sync event: dedup via processed_signals, session, event, intent.
 * Throws on error. Caller handles DLQ/retry semantics.
 */
export async function processSyncEvent(
  job: WorkerJob,
  siteIdUuid: string,
  qstashMessageId: string | null
): Promise<ProcessSyncEventResult> {
  // const site_id = job.s; // unused
  const client_sid = typeof job.sid === 'string' ? job.sid : '';
  const session_month = typeof job.sm === 'string' ? job.sm : '';
  const event_action = typeof job.ea === 'string' ? job.ea : '';
  const url = getFinalUrl(job as import('@/lib/types/ingest').ValidIngestPayload);
  const meta: IngestMeta = (job.meta ?? {}) as IngestMeta;
  const referrer = typeof job.r === 'string' ? job.r : null;
  const userAgent = typeof job.ua === 'string' ? job.ua : 'Unknown';
  const ip = typeof job.ip === 'string' ? job.ip : '0.0.0.0';
  const event_category = typeof job.ec === 'string' ? job.ec : '';
  const event_label = typeof job.el === 'string' ? job.el : '';
  const event_value: number | null =
    typeof job.ev === 'number'
      ? Number.isFinite(job.ev) ? job.ev : null
      : typeof job.ev === 'string'
        ? (() => {
          const n = Number(job.ev);
          return Number.isFinite(n) ? n : null;
        })()
        : null;

  const dedupEventId = await getDedupEventIdForJob(job, url, qstashMessageId);

  const { error: dedupError } = await adminClient
    .from('processed_signals')
    .insert({ event_id: dedupEventId, site_id: siteIdUuid, status: 'processing' });

  if (dedupError) {
    const code = (dedupError as { code?: string })?.code;
    const message = (dedupError as { message?: string })?.message ?? '';
    if (code === '23505' || /duplicate key value/i.test(message)) {
      debugLog('[PROCESS_SYNC_EVENT] dedup hit', { dedup_event_id: dedupEventId, site_id: siteIdUuid });
      throw new DedupSkipError();
    }
    throw dedupError;
  }

  try {
    return await doProcessSyncEvent(job, siteIdUuid, dedupEventId, meta, url, referrer, userAgent, ip, event_category, event_action, event_label, event_value, session_month, client_sid);
  } catch (err) {
    try {
      await adminClient
        .from('processed_signals')
        .update({ status: 'failed' })
        .eq('event_id', dedupEventId);
    } catch { /* ignore */ }
    throw err;
  }
}

async function doProcessSyncEvent(
  job: WorkerJob,
  siteIdUuid: string,
  dedupEventId: string,
  meta: IngestMeta,
  url: string,
  referrer: string | null,
  userAgent: string,
  ip: string,
  event_category: string,
  event_action: string,
  event_label: string,
  event_value: number | null,
  session_month: string,
  client_sid: string
): Promise<ProcessSyncEventResult> {
  const site_id = job.s;
  void site_id;

  let urlObj: URL;
  let params: URLSearchParams;
  let safeUrl: string;
  let currentGclid: string | null;

  try {
    urlObj = new URL(url);
    params = urlObj.searchParams;
    safeUrl = url;
    currentGclid = params.get('gclid') || meta?.gclid || null;
  } catch {
    safeUrl = 'https://unknown.local/?malformed=1';
    params = new URLSearchParams();
    currentGclid = meta?.gclid || null;
  }

  if (event_action !== 'heartbeat') {
    const hasGclid = !!currentGclid;
    await incrementCapturedSafe(site_id, hasGclid);
  }

  const eventKind = getEventKind(event_category, event_action);
  switch (eventKind) {
    case 'heartbeat':
      break;
    case 'page_view':
      break;
    case 'click':
      break;
    case 'call_intent':
      break;
    case 'other':
      break;
    default:
      assertNever(eventKind);
  }

  const geoResult = extractGeoInfo(null, userAgent, meta);
  const { geoInfo, deviceInfo } = geoResult;
  if (typeof job.geo_city === 'string' && job.geo_city) geoInfo.city = job.geo_city;
  if (typeof job.geo_district === 'string' && job.geo_district) geoInfo.district = job.geo_district;
  if (typeof job.geo_country === 'string' && job.geo_country) geoInfo.country = job.geo_country;
  if (typeof job.geo_timezone === 'string' && job.geo_timezone) geoInfo.timezone = job.geo_timezone;
  if (typeof job.geo_telco_carrier === 'string' && job.geo_telco_carrier) geoInfo.telco_carrier = job.geo_telco_carrier;
  if (job.isp_asn != null) {
    geoInfo.isp_asn =
      typeof job.isp_asn === 'string' ? job.isp_asn : typeof job.isp_asn === 'number' ? String(job.isp_asn) : geoInfo.isp_asn;
  }
  if (job.is_proxy_detected != null) geoInfo.is_proxy_detected = Boolean(job.is_proxy_detected);

  // Worker-side ghost geo: when site has strict mode, override ghost cities to Unknown/null (covers fallback/replay)
  const siteIngestConfig = await getSiteIngestConfig(siteIdUuid);
  const ghostGeoStrict = siteIngestConfig.ghost_geo_strict || siteIngestConfig.ingest_strict_mode;
  if (ghostGeoStrict && (isGhostGeoCity(geoInfo.city) || isGhostGeoCity(geoInfo.district))) {
    geoInfo.city = 'Unknown';
    geoInfo.district = null;
  }

  const fingerprint = meta?.fp || null;

  const dbMonth =
    session_month ||
    (() => {
      const nowUtc = new Date();
      const year = nowUtc.getUTCFullYear();
      const month = String(nowUtc.getUTCMonth() + 1).padStart(2, '0');
      return `${year}-${month}-01`;
    })();

  const { attribution, utm } = await AttributionService.resolveAttribution(siteIdUuid, currentGclid, fingerprint, safeUrl, referrer);
  let attributionSource = attribution.source;
  // When traffic_debloat: only attribute as Google Ads when valid click-id present (length >= 10)
  const trafficDebloat = siteIngestConfig.traffic_debloat || siteIngestConfig.ingest_strict_mode;
  if (trafficDebloat && attributionSource.includes('Ads')) {
    const gclid = params.get('gclid') || meta?.gclid || null;
    const wbraid = params.get('wbraid') || meta?.wbraid || null;
    const gbraid = params.get('gbraid') || meta?.gbraid || null;
    if (!hasValidClickId({ gclid, wbraid, gbraid })) attributionSource = 'Direct';
  }
  const deviceType =
    utm?.device && /^(mobile|desktop|tablet)$/i.test(utm.device) ? utm.device.toLowerCase() : deviceInfo.device_type;

  const consentScopes = Array.isArray(job.consent_scopes)
    ? (job.consent_scopes as string[]).map((s) => String(s).toLowerCase())
    : [];

  const pageView10sReuse = siteIngestConfig.page_view_10s_session_reuse || siteIngestConfig.ingest_strict_mode;
  const isPageView = event_action === 'page_view' || event_category === 'page';
  let session: { id: string; created_month: string } | null = null;

  if (pageView10sReuse && isPageView && fingerprint) {
    const tenSecAgo = new Date(Date.now() - 10_000).toISOString();
    const normalizedUrl = normalizeLandingUrl(safeUrl);
    const { data: candidates } = await adminClient
      .from('sessions')
      .select('id, created_month, entry_page')
      .eq('site_id', siteIdUuid)
      .eq('fingerprint', fingerprint)
      .gte('created_at', tenSecAgo)
      .order('created_at', { ascending: false })
      .limit(5);
    if (candidates?.length) {
      for (const row of candidates) {
        const entry = typeof row.entry_page === 'string' ? row.entry_page : '';
        if (normalizeLandingUrl(entry) === normalizedUrl) {
          session = { id: row.id, created_month: row.created_month };
          try {
            await adminClient.from('sessions').update({ updated_at: new Date().toISOString() }).eq('site_id', siteIdUuid).eq('id', row.id).eq('created_month', row.created_month);
          } catch { /* updated_at column may not exist */ }
          break;
        }
      }
    }
  }

  if (!session) {
    session = await SessionService.handleSession(
      siteIdUuid,
      dbMonth,
      {
        client_sid,
        url: safeUrl,
        currentGclid,
        meta,
        params,
        attributionSource,
        deviceType,
        fingerprint,
        utm,
        referrer,
        consent_scopes: consentScopes.length > 0 ? consentScopes : undefined,
      },
      { ip, userAgent, geoInfo, deviceInfo }
    );
  }
  if (!session) {
    throw new Error('session_resolution_failed');
  }

  // Deterministik geo: GCLID + loc_physical_ms/loc_interest_ms → ADS geo
  const geoCriteriaId = utm?.loc_physical_ms || utm?.loc_interest_ms;
  if (currentGclid && geoCriteriaId) {
    try {
      const id = parseInt(String(geoCriteriaId), 10);
      if (Number.isFinite(id)) {
        const { data: geoRow } = await adminClient
          .from('google_geo_targets')
          .select('canonical_name')
          .eq('criteria_id', id)
          .single();
        if (geoRow?.canonical_name) {
          const parts = String(geoRow.canonical_name).split(',').map((p: string) => p.trim());
          const district = parts.length >= 2 ? `${parts[0]} / ${parts[1]}` : parts[0] || null;
          const city = parts.length >= 2 ? parts[1] : null;
          await upsertSessionGeo({
            siteId: siteIdUuid,
            sessionId: session.id,
            sessionMonth: session.created_month,
            city,
            district,
            source: 'ADS',
          });
        }
      }
    } catch (geoErr) {
      debugLog('[PROCESS_SYNC_EVENT] geo upsert skip', { session_id: session.id, error: (geoErr as Error)?.message });
    }
  }

  let summary = 'Standard Traffic';
  if (attributionSource.includes('Ads')) summary = 'Ads Origin';

  const { leadScore } = await EventService.createEvent({
    session: { id: session.id, created_month: session.created_month },
    siteId: siteIdUuid,
    consent_scopes: consentScopes.length > 0 ? consentScopes : undefined,
    url: safeUrl,
    event_category,
    event_action,
    event_label,
    event_value,
    meta,
    referrer,
    currentGclid,
    attributionSource,
    summary,
    fingerprint,
    ip,
    userAgent,
    geoInfo,
    deviceInfo,
    client_sid,
    ingestDedupId: dedupEventId,
  });

  if (event_action !== 'heartbeat') {
    const callId = await IntentService.handleIntent(
      siteIdUuid,
      { id: session.id },
      { fingerprint, event_action, event_label, meta, url: safeUrl, currentGclid, params },
      leadScore
    );
    if (callId) {
      try {
        const primary = await getPrimarySource(siteIdUuid, { callId });
        const now = new Date();
        const v2Result = await evaluateAndRouteSignal('V2_PULSE', {
          siteId: siteIdUuid,
          callId,
          gclid: primary?.gclid ?? null,
          wbraid: primary?.wbraid ?? null,
          gbraid: primary?.gbraid ?? null,
          aov: 0,
          clickDate: now,
          signalDate: now,
          clientIp: ip,
          traceId: null,
        });
        if (!v2Result.routed) {
          logWarn('V2_PULSE_NOT_ROUTED', {
            site_id: siteIdUuid,
            call_id: callId,
            dropped: v2Result.dropped ?? false,
            has_gclid: Boolean(primary?.gclid),
            has_wbraid: Boolean(primary?.wbraid),
            has_gbraid: Boolean(primary?.gbraid),
          });
        }
      } catch (v2Err) {
        debugLog('[PROCESS_SYNC_EVENT] V2_PULSE emit failed (non-fatal)', { call_id: callId, error: (v2Err as Error)?.message });
      }
    }
  }

  await adminClient
    .from('processed_signals')
    .update({ status: 'processed' })
    .eq('event_id', dedupEventId);

  debugLog('[PROCESS_SYNC_EVENT] success', {
    dedup_event_id: dedupEventId,
    site_id: siteIdUuid,
    session_id: session.id,
    score: leadScore,
  });

  return { success: true, score: leadScore };
}

/** Thrown when processed_signals dedup hit (QStash retry); caller should ack 200. */
export class DedupSkipError extends Error {
  constructor() {
    super('Dedup skip');
    this.name = 'DedupSkipError';
  }
}
