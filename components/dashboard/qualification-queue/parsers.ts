import type { HunterIntent, HunterIntentLite } from '@/lib/types/hunter';

/** Raw row shape from RPC (get_recent_intents_v2, etc.). All fields optional. */
interface RpcIntentRow {
  id?: unknown;
  created_at?: unknown;
  intent_action?: unknown;
  intent_target?: unknown;
  summary?: unknown;
  intent_page_url?: unknown;
  page_url?: unknown;
  matched_session_id?: unknown;
  lead_score?: unknown;
  status?: unknown;
  click_id?: unknown;
  intent_stamp?: unknown;
  utm_term?: unknown;
  utm_campaign?: unknown;
  utm_source?: unknown;
  matchtype?: unknown;
  city?: unknown;
  district?: unknown;
  device_type?: unknown;
  device_os?: unknown;
  ads_network?: unknown;
  ads_placement?: unknown;
  risk_level?: unknown;
  risk_reasons?: unknown;
  ai_score?: unknown;
  ai_summary?: unknown;
  ai_tags?: unknown;
  total_duration_sec?: unknown;
  estimated_value?: unknown;
  currency?: unknown;
  oci_stage?: unknown;
  oci_status?: unknown;
  attribution_source?: unknown;
  gclid?: unknown;
  wbraid?: unknown;
  gbraid?: unknown;
  event_count?: unknown;
  phone_clicks?: unknown;
  whatsapp_clicks?: unknown;
  traffic_source?: unknown;
  traffic_medium?: unknown;
  intent_events?: unknown;
}

function rowStr(r: RpcIntentRow, key: keyof RpcIntentRow): string | null {
  const v = r[key];
  if (v == null) return null;
  return String(v);
}
function rowNum(r: RpcIntentRow, key: keyof RpcIntentRow): number | null {
  const v = r[key];
  return typeof v === 'number' ? v : null;
}
function rowArr(r: RpcIntentRow, key: keyof RpcIntentRow): string[] | null {
  const v = r[key];
  return Array.isArray(v) ? (v as string[]) : null;
}

export function parseHunterIntentsFull(data: unknown): HunterIntent[] {
  if (!data) return [];
  let rows: RpcIntentRow[] = [];

  const raw = data;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return [];
    if (raw.length === 1 && Array.isArray(raw[0])) {
      rows = raw[0] as RpcIntentRow[];
    } else if (typeof raw[0] === 'string') {
      rows = raw
        .map((item: unknown): RpcIntentRow | null => {
          try {
            return (typeof item === 'string' ? JSON.parse(item) : item) as RpcIntentRow | null;
          } catch {
            return null;
          }
        })
        .filter((r): r is RpcIntentRow => r != null);
    } else {
      rows = raw as RpcIntentRow[];
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const arr = (obj.data ?? obj.rows ?? obj.intents) as unknown[];
    if (Array.isArray(arr)) rows = arr as RpcIntentRow[];
  }

  // Basic shape validation: need id for card key
  return rows.filter((r): r is RpcIntentRow => r != null && r.id != null).map((r) => ({
    id: String(r.id),
    created_at: String(r.created_at),
    intent_action: r.intent_action ?? null,
    intent_target: (r.intent_target ?? r.summary) ?? null,
    intent_page_url: r.intent_page_url ?? null,
    page_url: r.page_url ?? r.intent_page_url ?? null,
    matched_session_id: r.matched_session_id ?? null,
    lead_score: r.lead_score ?? null,
    status: r.status ?? null,
    click_id: r.click_id ?? null,
    intent_stamp: r.intent_stamp ?? null,
    utm_term: r.utm_term ?? null,
    utm_campaign: r.utm_campaign ?? null,
    utm_source: r.utm_source ?? null,
    matchtype: r.matchtype ?? null,
    city: r.city ?? null,
    district: r.district ?? null,
    device_type: r.device_type ?? null,
    device_os: r.device_os ?? null,
    ads_network: r.ads_network ?? null,
    ads_placement: r.ads_placement ?? null,
    risk_level: r.risk_level ?? null,
    risk_reasons: rowArr(r, 'risk_reasons'),
    ai_score: rowNum(r, 'ai_score'),
    ai_summary: typeof r.ai_summary === 'string' ? r.ai_summary : null,
    ai_tags: rowArr(r, 'ai_tags'),
    total_duration_sec: rowNum(r, 'total_duration_sec'),
    estimated_value: rowNum(r, 'estimated_value'),
    currency: r.currency ?? null,
    oci_stage: r.oci_stage ?? null,
    oci_status: r.oci_status ?? null,
    attribution_source: r.attribution_source ?? null,
    gclid: r.gclid ?? null,
    wbraid: r.wbraid ?? null,
    gbraid: r.gbraid ?? null,
    event_count: rowNum(r, 'event_count'),
    phone_clicks: rowNum(r, 'phone_clicks'),
    whatsapp_clicks: rowNum(r, 'whatsapp_clicks'),
    traffic_source: typeof r.traffic_source === 'string' ? r.traffic_source : null,
    traffic_medium: typeof r.traffic_medium === 'string' ? r.traffic_medium : null,
  })) as HunterIntent[];
}

export function parseHunterIntentsLite(data: unknown): HunterIntentLite[] {
  if (!data) return [];
  let rows: RpcIntentRow[] = [];

  const raw = data;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return [];
    if (raw.length === 1 && Array.isArray(raw[0])) {
      rows = raw[0] as RpcIntentRow[];
    } else if (typeof raw[0] === 'string') {
      rows = raw
        .map((item: unknown): RpcIntentRow | null => {
          try {
            return (typeof item === 'string' ? JSON.parse(item) : item) as RpcIntentRow | null;
          } catch {
            return null;
          }
        })
        .filter((r): r is RpcIntentRow => r != null);
    } else {
      rows = raw as RpcIntentRow[];
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const arr = (obj.data ?? obj.rows ?? obj.intents) as unknown[];
    if (Array.isArray(arr)) rows = arr as RpcIntentRow[];
  }

  return rows
    .filter((r): r is RpcIntentRow => r != null && r.id != null && r.created_at != null)
    .map((r) => ({
      id: String(r.id),
      created_at: String(r.created_at),
      status: (r.status as string | null | undefined) ?? null,
      matched_session_id: (r.matched_session_id as string | null | undefined) ?? null,
      intent_action: (r.intent_action as string | null | undefined) ?? null,
      summary: (r.summary as string | null | undefined) ?? null,
      phone_clicks: rowNum(r, 'phone_clicks'),
      whatsapp_clicks: rowNum(r, 'whatsapp_clicks'),
      intent_events: rowNum(r, 'intent_events'),
      traffic_source: typeof r.traffic_source === 'string' ? r.traffic_source : null,
      traffic_medium: typeof r.traffic_medium === 'string' ? r.traffic_medium : null,
    })) as HunterIntentLite[];
}

