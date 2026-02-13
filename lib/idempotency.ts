/**
 * API-edge idempotency for the ingestion pipeline.
 * v1: SHA256(site_id + event_name + normalized_url + session_fingerprint + time_bucket_5s). Unchanged; no prefix.
 * v2: computeIdempotencyKeyV2() returns "v2:" + SHA256(..., bucket_component) with event-specific buckets.
 * No client-supplied IDs; no IP/UA (high cardinality).
 *
 * --- REVENUE KERNEL: Invoice authority ---
 * Invoice authority: Postgres ingest_idempotency ONLY.
 * Invoice count = COUNT(ingest_idempotency) per (site_id, billing_month). Never Redis, events, sessions, or fallback.
 */

import { adminClient } from '@/lib/supabase/admin';
import { getFinalUrl, type ValidIngestPayload } from '@/lib/types/ingest';

/** Retention: 90 days (Revenue Kernel spec). Required for billing period + dispute window. */
const IDEMPOTENCY_RETENTION_DAYS = 90;

/** PR-2: Read idempotency version from env (for route and tests). Default "1". */
export function getIdempotencyVersion(): 1 | 2 {
  return process.env.OPSMANTIK_IDEMPOTENCY_VERSION === '2' ? 2 : 1;
}

/** Server time (ms). Wrapper for testability; production uses Date.now(). */
export function getServerNowMs(): number {
  return Date.now();
}

/**
 * Compute 5-second time bucket (Unix ms floored to 5s). Same window => same key component. (v1 only)
 */
function timeBucket5s(): number {
  return Math.floor(Date.now() / 5000) * 5000;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** Event kind for v2 idempotency (determines time source and bucketing). */
function getV2EventKind(payload: ValidIngestPayload): 'heartbeat' | 'page_view' | 'click' | 'call_intent' | 'other' {
  const p = payload as Record<string, unknown>;
  const ec = typeof p.ec === 'string' ? p.ec : '';
  const ea = typeof p.ea === 'string' ? p.ea : '';
  if (ea === 'heartbeat') return 'heartbeat';
  if (ec === 'page' || ea === 'page_view') return 'page_view';
  if (ea === 'click' || ec === 'click') return 'click';
  if (ea === 'call_intent') return 'call_intent';
  return 'other';
}

/** ISO-like string check: only parse as timestamp if it looks like ISO 8601 (e.g. 2025-01-15T...). Avoids locale/random strings. */
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}T/;

/** Extract optional client timestamp from payload (ts, timestamp, created_at, meta.ts). Normalized to ms. Returns null if missing/invalid. Does NOT use "t" (too generic; can mean "type"). String parse only for ISO-like format. */
function extractPayloadTsMs(payload: ValidIngestPayload): number | null {
  const p = payload as Record<string, unknown>;
  const meta = p.meta as Record<string, unknown> | undefined;
  const raw =
    typeof p.ts === 'number' ? p.ts
    : typeof p.timestamp === 'number' ? p.timestamp
    : typeof p.created_at === 'number' ? p.created_at
    : typeof meta?.ts === 'number' ? meta.ts
    : typeof p.ts === 'string' ? parseFloat(p.ts)
    : typeof p.timestamp === 'string' && ISO_LIKE.test(String(p.timestamp)) ? Date.parse(p.timestamp)
    : typeof p.created_at === 'string' && ISO_LIKE.test(String(p.created_at)) ? Date.parse(p.created_at)
    : null;
  if (raw == null || Number.isNaN(raw)) return null;
  const ms = raw < 1e12 ? raw * 1000 : raw;
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms);
}

/**
 * v2 time component for dedup key. Security: click/call_intent use server time only (ignore client ts).
 * heartbeat/page_view may use payload ts if within 5 min of server; else clamped to server. Then bucket applied.
 */
function getV2TimeComponentSafe(payload: ValidIngestPayload, serverNowMs: number): number {
  const kind = getV2EventKind(payload);

  if (kind === 'click' || kind === 'call_intent') {
    return serverNowMs;
  }

  let tsMs = serverNowMs;
  if (kind === 'heartbeat' || kind === 'page_view') {
    const payloadTs = extractPayloadTsMs(payload);
    if (payloadTs != null && Math.abs(payloadTs - serverNowMs) <= FIVE_MINUTES_MS) {
      tsMs = payloadTs;
    }
  }

  if (kind === 'heartbeat') return Math.floor(tsMs / 10_000) * 10_000;
  if (kind === 'page_view') return Math.floor(tsMs / 2_000) * 2_000;
  return Math.floor(tsMs / 2_000) * 2_000;
}

/**
 * Build event name from category/action/label (stable string for hashing).
 */
function eventName(payload: ValidIngestPayload): string {
  const p = payload as Record<string, unknown>;
  const ec = typeof p.ec === 'string' ? p.ec : '';
  const ea = typeof p.ea === 'string' ? p.ea : '';
  const el = typeof p.el === 'string' ? p.el : '';
  return `${ec}|${ea}|${el}`;
}

/**
 * Session fingerprint: meta.fp or sid, never IP/UA.
 */
function sessionFingerprint(payload: ValidIngestPayload): string {
  const p = payload as Record<string, unknown>;
  const meta = p.meta as Record<string, unknown> | undefined;
  const fp = meta && typeof meta.fp === 'string' ? meta.fp : '';
  const sid = typeof p.sid === 'string' ? p.sid : '';
  return fp || sid || '';
}

/**
 * v1 idempotency key: SHA-256(site_id + event_name + normalized_url + session_fingerprint + time_bucket_5s).
 * Same inputs => same output. No prefix. Do not change; billing depends on stable v1 keys.
 */
export async function computeIdempotencyKey(
  siteIdUuid: string,
  payload: ValidIngestPayload
): Promise<string> {
  const url = getFinalUrl(payload);
  const bucket = timeBucket5s();
  const input = `${siteIdUuid}:${eventName(payload)}:${url}:${sessionFingerprint(payload)}:${bucket}`;
  const data = new TextEncoder().encode(input);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * v2 idempotency key: "v2:" + SHA-256(site_id + event_name + normalized_url + session_fingerprint + time_component).
 * click/call_intent: server time only (no client ts) to prevent dedup bypass. heartbeat/page_view: payload ts clamped to ±5min, then bucket.
 */
export async function computeIdempotencyKeyV2(
  siteIdUuid: string,
  payload: ValidIngestPayload,
  serverNowMs: number = getServerNowMs()
): Promise<string> {
  const url = getFinalUrl(payload);
  const timeComponent = getV2TimeComponentSafe(payload, serverNowMs);
  const input = `${siteIdUuid}:${eventName(payload)}:${url}:${sessionFingerprint(payload)}:${timeComponent}`;
  const data = new TextEncoder().encode(input);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `v2:${hex}`;
}

/**
 * Deterministic server-side expires_at: now + 90 days (Revenue Kernel retention).
 * Used for idempotency row TTL; cleanup job may DELETE WHERE expires_at < NOW() (non-invoice-critical).
 */
export function computeIdempotencyExpiresAt(now: Date = new Date()): Date {
  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + IDEMPOTENCY_RETENTION_DAYS);
  return expiresAt;
}

/**
 * Derive idempotency_version from stored key (v2:<hash> => 2, else 1). PR-2.
 */
export function idempotencyVersionFromKey(idempotencyKey: string): 1 | 2 {
  return idempotencyKey.startsWith('v2:') ? 2 : 1;
}

export type TryInsertIdempotencyResult = {
  inserted: boolean;
  duplicate: boolean;
  error?: unknown;
};

/** Arguments for the insert operation (DI). */
export type IdempotencyInsertArgs = {
  siteIdUuid: string;
  idempotencyKey: string;
  createdAt: string;
  expiresAt: string;
  idempotencyVersion: number;
};

/** Dependency: performs the insert and returns raw result. Used for DI in tests. */
export type IdempotencyInserter = (args: IdempotencyInsertArgs) => Promise<{ error?: unknown }>;

async function defaultInserter(args: IdempotencyInsertArgs): Promise<{ error?: unknown }> {
  const { error } = await adminClient.from('ingest_idempotency').insert({
    site_id: args.siteIdUuid,
    idempotency_key: args.idempotencyKey,
    idempotency_version: args.idempotencyVersion,
    created_at: args.createdAt,
    expires_at: args.expiresAt,
  });
  return { error };
}

/**
 * Insert idempotency key. Fail-secure: only inserted=true is billable.
 * - inserted: true → success, continue to quota/publish.
 * - duplicate: true → unique violation (23505), return 200 dedup, do NOT publish.
 * - error set and duplicate: false → DB error, return 500, do NOT publish (financial integrity).
 * @param opts.inserter — optional DI; default uses adminClient insert.
 */
export async function tryInsertIdempotencyKey(
  siteIdUuid: string,
  idempotencyKey: string,
  opts?: { inserter?: IdempotencyInserter }
): Promise<TryInsertIdempotencyResult> {
  const now = new Date();
  const expiresAt = computeIdempotencyExpiresAt(now);
  const version = idempotencyVersionFromKey(idempotencyKey);
  const inserter = opts?.inserter ?? defaultInserter;

  const { error } = await inserter({
    siteIdUuid,
    idempotencyKey,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    idempotencyVersion: version,
  });

  if (error) {
    const code = typeof (error as { code?: string }).code === 'string' ? (error as { code: string }).code : '';
    const message = typeof (error as { message?: string }).message === 'string' ? (error as { message: string }).message : '';
    const isDuplicate = code === '23505' || /duplicate key value/i.test(message);
    if (isDuplicate) return { inserted: false, duplicate: true };
    return { inserted: false, duplicate: false, error };
  }
  return { inserted: true, duplicate: false };
}

/**
 * PR-3 Quota reject: set billable=false on the idempotency row so it does not count toward invoice.
 * billing_state remains ACCEPTED (no REJECTED_QUOTA enum); row exists for audit, billable=false for SoT.
 */
export async function updateIdempotencyBillableFalse(
  siteIdUuid: string,
  idempotencyKey: string
): Promise<{ updated: boolean; error?: unknown }> {
  const { error } = await adminClient
    .from('ingest_idempotency')
    .update({ billable: false })
    .eq('site_id', siteIdUuid)
    .eq('idempotency_key', idempotencyKey);

  if (error) return { updated: false, error };
  return { updated: true };
}

/**
 * PR-3 Overage: mark the idempotency row as OVERAGE for billing classification.
 */
export async function setOverageOnIdempotencyRow(
  siteIdUuid: string,
  idempotencyKey: string
): Promise<{ updated: boolean; error?: unknown }> {
  const { error } = await adminClient
    .from('ingest_idempotency')
    .update({ billing_state: 'OVERAGE' })
    .eq('site_id', siteIdUuid)
    .eq('idempotency_key', idempotencyKey);

  if (error) return { updated: false, error };
  return { updated: true };
}
