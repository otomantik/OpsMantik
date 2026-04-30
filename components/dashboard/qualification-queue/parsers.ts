import type { HunterIntent, HunterIntentLite } from '@/lib/types/hunter';

/** Raw row shape from RPC (get_recent_intents_v2, etc.). All fields optional. */
interface RpcIntentRow {
  id?: unknown;
  version?: unknown;
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
  location_source?: unknown;
  location_reason_code?: unknown;
  location_confidence?: unknown;
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
  form_state?: unknown;
  form_summary?: unknown;
  reviewed_at?: unknown;
  reviewed_by?: unknown;
  dedupe_key?: unknown;
  canonical_intent_key?: unknown;
  duplicate_hint?: unknown;
}

function rowNum(r: RpcIntentRow, key: keyof RpcIntentRow): number | null {
  const v = r[key];
  return typeof v === 'number' ? v : null;
}
function rowArr(r: RpcIntentRow, key: keyof RpcIntentRow): string[] | null {
  const v = r[key];
  return Array.isArray(v) ? (v as string[]) : null;
}
function rowObj(r: RpcIntentRow, key: keyof RpcIntentRow): Record<string, unknown> | null {
  const v = r[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
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
    version: rowNum(r, 'version'),
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
    location_source: typeof r.location_source === 'string' ? r.location_source : null,
    location_reason_code: typeof r.location_reason_code === 'string' ? r.location_reason_code : null,
    location_confidence: rowNum(r, 'location_confidence'),
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
    form_state: typeof r.form_state === 'string' ? r.form_state : null,
    form_summary: rowObj(r, 'form_summary'),
    reviewed_at: typeof r.reviewed_at === 'string' ? r.reviewed_at : null,
    reviewed_by: typeof r.reviewed_by === 'string' ? r.reviewed_by : null,
    dedupe_key: typeof r.dedupe_key === 'string' ? r.dedupe_key : null,
    canonical_intent_key: typeof r.canonical_intent_key === 'string' ? r.canonical_intent_key : null,
    duplicate_hint: typeof r.duplicate_hint === 'boolean' ? r.duplicate_hint : null,
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
      version: rowNum(r, 'version'),
      created_at: String(r.created_at),
      status: (r.status as string | null | undefined) ?? null,
      matched_session_id: (r.matched_session_id as string | null | undefined) ?? null,
      intent_action: (r.intent_action as string | null | undefined) ?? null,
      summary: (r.summary as string | null | undefined) ?? null,
      intent_target: (r.intent_target as string | null | undefined) ?? null,
      intent_page_url: (r.intent_page_url as string | null | undefined) ?? null,
      page_url: (r.page_url as string | null | undefined) ?? ((r.intent_page_url as string | null | undefined) ?? null),
      click_id: (r.click_id as string | null | undefined) ?? null,
      phone_clicks: rowNum(r, 'phone_clicks'),
      whatsapp_clicks: rowNum(r, 'whatsapp_clicks'),
      intent_events: rowNum(r, 'intent_events'),
      traffic_source: typeof r.traffic_source === 'string' ? r.traffic_source : null,
      traffic_medium: typeof r.traffic_medium === 'string' ? r.traffic_medium : null,
      attribution_source: (r.attribution_source as string | null | undefined) ?? null,
      gclid: (r.gclid as string | null | undefined) ?? null,
      wbraid: (r.wbraid as string | null | undefined) ?? null,
      gbraid: (r.gbraid as string | null | undefined) ?? null,
      utm_term: (r.utm_term as string | null | undefined) ?? null,
      utm_campaign: (r.utm_campaign as string | null | undefined) ?? null,
      utm_source: (r.utm_source as string | null | undefined) ?? null,
      matchtype: (r.matchtype as string | null | undefined) ?? null,
      city: (r.city as string | null | undefined) ?? null,
      district: (r.district as string | null | undefined) ?? null,
      location_source: typeof r.location_source === 'string' ? r.location_source : null,
      location_reason_code: typeof r.location_reason_code === 'string' ? r.location_reason_code : null,
      location_confidence: rowNum(r, 'location_confidence'),
      device_type: (r.device_type as string | null | undefined) ?? null,
      device_os: (r.device_os as string | null | undefined) ?? null,
      total_duration_sec: rowNum(r, 'total_duration_sec'),
      event_count: rowNum(r, 'event_count'),
      estimated_value: rowNum(r, 'estimated_value'),
      currency: (r.currency as string | null | undefined) ?? null,
      form_state: typeof r.form_state === 'string' ? r.form_state : null,
      form_summary: rowObj(r, 'form_summary'),
      reviewed_at: typeof r.reviewed_at === 'string' ? r.reviewed_at : null,
      reviewed_by: typeof r.reviewed_by === 'string' ? r.reviewed_by : null,
      dedupe_key: typeof r.dedupe_key === 'string' ? r.dedupe_key : null,
      canonical_intent_key: typeof r.canonical_intent_key === 'string' ? r.canonical_intent_key : null,
      duplicate_hint: typeof r.duplicate_hint === 'boolean' ? r.duplicate_hint : null,
    })) as HunterIntentLite[];
}

