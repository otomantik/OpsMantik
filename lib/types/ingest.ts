/**
 * Strict types for the critical ingest + worker pipeline.
 *
 * Design goals:
 * - Avoid `any` on req.json() payloads (treat as unknown).
 * - Provide fast, minimal runtime validation + TS narrowing.
 * - Preserve unknown extra fields (tracker payloads evolve).
 */

export type IngestMeta = Record<string, unknown> & {
  // Attribution / identifiers
  fp?: string;
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
  fbclid?: string;
  ttclid?: string;
  msclkid?: string;

  // Google Ads template params (optional; server also parses from URL)
  utm_adgroup?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  device?: string;
  devicemodel?: string;
  targetid?: string;
  network?: string;
  adposition?: string;
  feeditemid?: string;
  loc_interest_ms?: string;
  loc_physical_ms?: string;
  matchtype?: string;

  // Device DNA (compact tracker keys used in extractGeoInfo)
  lan?: string;
  mem?: string | number;
  con?: string | number;
  sw?: string | number;
  sh?: string | number;
  dpr?: string | number;
  gpu?: string;

  // Geo overrides (optional)
  city?: string;
  district?: string;
  country?: string;
  timezone?: string;

  // Session stats signals
  duration_sec?: number;
  scroll_pct?: number;
  cta_hovers?: number;
  focus_dur?: number;
  active_sec?: number;
  exit_page?: string;

  // Extended signals
  con_type?: string;

  // KVKK/GDPR consent scopes (analytics, marketing)
  consent_scopes?: string[];
};

/**
 * Raw ingest payload as sent by the tracker to POST /api/sync.
 * Keys are short for payload size: s/url/u/sid/sm/ec/ea/el/ev/meta/r.
 */
export type IngestPayload = Record<string, unknown> & {
  s?: string; // site public_id (required for processing)
  url?: string; // full URL (preferred)
  u?: string; // fallback URL key (legacy/minified)
  sid?: string; // client session id (may be UUID or random)
  sm?: string; // session_month (YYYY-MM-01)
  ec?: string; // event_category
  ea?: string; // event_action
  el?: string; // event_label
  ev?: number | string | null; // event_value
  meta?: IngestMeta; // metadata blob
  r?: string; // referrer
};

export type ValidIngestPayloadBase = Record<string, unknown> & {
  s: string;
  sid?: string;
  sm?: string;
  ec?: string;
  ea?: string;
  el?: string;
  ev?: number | string | null;
  meta?: IngestMeta;
  r?: string;
};

export type ValidIngestPayload =
  & ValidIngestPayloadBase
  & ({ url: string; u?: undefined } | { u: string; url?: undefined });

/**
 * Worker payload is ingest payload + producer-enriched fields.
 */
export type WorkerJobData = IngestPayload & {
  ingest_id?: string;
  ip?: string;
  ua?: string;

  geo_city?: string;
  geo_district?: string;
  geo_country?: string;
  geo_timezone?: string;
  geo_telco_carrier?: string;
  isp_asn?: number | string;
  is_proxy_detected?: boolean | number;
};

export type ValidWorkerJobData =
  & WorkerJobData
  & ValidIngestPayload;

export type ParseResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'invalid'; error: string };

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const MAX_UA_LEN = 512;
const MAX_REFERRER_LEN = 2048;
const MAX_URL_LEN = 4096;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function asMeta(v: unknown): IngestMeta | undefined {
  if (!isRecord(v)) return undefined;
  return v as IngestMeta;
}

export function normalizeSiteId(v: unknown): string | null {
  return asNonEmptyString(v);
}

export function normalizeUrl(url: unknown): string | null {
  // Convert to string, trim, truncate, empty => null
  if (url === undefined || url === null) return null;
  const s = truncate(String(url).trim(), MAX_URL_LEN);
  return s.length > 0 ? s : null;
}

export function normalizeReferrer(v: unknown): string | undefined {
  const s = asNonEmptyString(v);
  if (!s) return undefined;
  return truncate(s, MAX_REFERRER_LEN);
}

export function normalizeUserAgent(v: unknown): string {
  const s = asNonEmptyString(v);
  if (!s) return 'Unknown';
  return truncate(s, MAX_UA_LEN);
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
  }
  return true;
}

function isProbablyIpv6(ip: string): boolean {
  // Minimal check: contains ':' and only hex/delims. (We don't need full IPv6 validation here.)
  if (!ip.includes(':')) return false;
  if (ip.length > 64) return false;
  return /^[0-9a-f:%.\[\]]+$/i.test(ip);
}

export function normalizeIp(v: unknown): string {
  const s = asNonEmptyString(v);
  if (!s) return '0.0.0.0';
  // Common header form: "client, proxy1, proxy2"
  const first = s.split(',')[0]?.trim() ?? '';
  if (!first) return '0.0.0.0';
  if (isValidIpv4(first) || isProbablyIpv6(first)) return first;
  return '0.0.0.0';
}

/**
 * Parses tracker payload. Intended semantics:
 * - If payload is structurally invalid (non-object) => invalid (400).
 * - If missing required identifiers (s, url/u) => invalid (400).
 * - Else => ok with a narrowed ValidIngestPayload.
 */
export function parseValidIngestPayload(input: unknown): ParseResult<ValidIngestPayload> {
  if (!isRecord(input)) {
    return { kind: 'invalid', error: 'payload_not_object' };
  }

  const s = normalizeSiteId(input.s);
  const url = normalizeUrl(input.url);
  const u = normalizeUrl(input.u);

  if (!s || (!url && !u)) {
    return { kind: 'invalid', error: 'missing_site_or_url' };
  }

  // Normalize meta if present but not object
  const meta = asMeta(input.meta);
  const r = normalizeReferrer(input.r);
  // Important: do NOT carry both url + u forward (union guarantee + DB safety).
  const { url: _rawUrl, u: _rawU, s: _rawS, meta: _rawMeta, r: _rawR, ...rest } = input as IngestPayload;
  const normalizedBase: ValidIngestPayloadBase = {
    ...rest,
    s,
    ...(meta ? { meta } : {}),
    ...(r ? { r } : {}),
  };
  if (url) {
    return { kind: 'ok', data: { ...normalizedBase, url } as ValidIngestPayload };
  }
  return { kind: 'ok', data: { ...normalizedBase, u: u! } as ValidIngestPayload };
}

export function parseValidWorkerJobData(input: unknown): ParseResult<ValidWorkerJobData> {
  const base = parseValidIngestPayload(input);
  if (base.kind !== 'ok') return base as ParseResult<ValidWorkerJobData>;
  // Worker accepts extra producer-enriched keys; normalize critical-but-non-blocking metadata.
  const rec = input as Record<string, unknown>;

  // Re-apply URL normalization defensively (ensures worker never processes oversized/empty URL).
  // Note: base.data already has normalized url/u, but we validate again per hardening strategy.
  const normalizedUrl = normalizeUrl((base.data as IngestPayload).url ?? (base.data as IngestPayload).u);
  if (!normalizedUrl) {
    return { kind: 'invalid', error: 'missing_site_or_url' };
  }

  const ip = normalizeIp(rec.ip);
  const ua = normalizeUserAgent(rec.ua);
  const data: ValidWorkerJobData = {
    ...(base.data as ValidWorkerJobData),
    ip,
    ua,
  };
  return { kind: 'ok', data };
}

export function getFinalUrl(payload: ValidIngestPayload): string {
  // We intentionally avoid relying on `'url' in payload` because ValidIngestPayload
  // carries unknown extra keys (index signature), which can confuse TS narrowing.
  // Runtime invariant: parser guarantees exactly one of url/u is a non-empty string.
  const p = payload as Record<string, unknown>;
  const url = p.url;
  if (typeof url === 'string') return url;
  const u = p.u;
  if (typeof u === 'string') return u;
  throw new Error('[INGEST] Missing url/u after validation');
}

