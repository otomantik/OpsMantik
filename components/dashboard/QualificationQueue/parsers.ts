import type { HunterIntent, HunterIntentLite } from '@/lib/types/hunter';

type RpcIntentRow = Record<string, unknown>;

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
  return rows.filter((r) => r != null && (r as any).id != null).map((r) => ({
    id: (r as any).id,
    created_at: (r as any).created_at,
    intent_action: (r as any).intent_action ?? null,
    // Lite list may provide 'summary' instead of full intent_target
    intent_target: ((r as any).intent_target ?? (r as any).summary) ?? null,
    intent_page_url: (r as any).intent_page_url ?? null,
    page_url: (r as any).page_url ?? (r as any).intent_page_url ?? null,
    matched_session_id: (r as any).matched_session_id ?? null,
    lead_score: (r as any).lead_score ?? null,
    status: (r as any).status ?? null,
    click_id: (r as any).click_id ?? null,
    intent_stamp: (r as any).intent_stamp ?? null,

    // Intel
    utm_term: (r as any).utm_term ?? null,
    utm_campaign: (r as any).utm_campaign ?? null,
    utm_source: (r as any).utm_source ?? null,
    matchtype: (r as any).matchtype ?? null,

    // Geo/Device
    city: (r as any).city ?? null,
    district: (r as any).district ?? null,
    device_type: (r as any).device_type ?? null,
    device_os: (r as any).device_os ?? null,
    ads_network: (r as any).ads_network ?? null,
    ads_placement: (r as any).ads_placement ?? null,

    // AI/Risk
    risk_level: (r as any).risk_level ?? null,
    risk_reasons: Array.isArray((r as any).risk_reasons) ? (r as any).risk_reasons : null,
    ai_score: typeof (r as any).ai_score === 'number' ? (r as any).ai_score : null,
    ai_summary: typeof (r as any).ai_summary === 'string' ? (r as any).ai_summary : null,
    ai_tags: Array.isArray((r as any).ai_tags) ? (r as any).ai_tags : null,
    total_duration_sec: typeof (r as any).total_duration_sec === 'number' ? (r as any).total_duration_sec : null,
    estimated_value: typeof (r as any).estimated_value === 'number' ? (r as any).estimated_value : null,
    currency: (r as any).currency ?? null,

    // OCI
    oci_stage: (r as any).oci_stage ?? null,
    oci_status: (r as any).oci_status ?? null,

    // Evidence
    attribution_source: (r as any).attribution_source ?? null,
    gclid: (r as any).gclid ?? null,
    wbraid: (r as any).wbraid ?? null,
    gbraid: (r as any).gbraid ?? null,
    event_count: typeof (r as any).event_count === 'number' ? (r as any).event_count : null,

    // Session-based action evidence (single card)
    phone_clicks: typeof (r as any).phone_clicks === 'number' ? (r as any).phone_clicks : null,
    whatsapp_clicks: typeof (r as any).whatsapp_clicks === 'number' ? (r as any).whatsapp_clicks : null,

    // Traffic source (from sessions join)
    traffic_source: typeof (r as any).traffic_source === 'string' ? (r as any).traffic_source : null,
    traffic_medium: typeof (r as any).traffic_medium === 'string' ? (r as any).traffic_medium : null,
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
    .filter((r) => r != null && (r as any).id != null && (r as any).created_at != null)
    .map((r) => ({
      id: String((r as any).id),
      created_at: String((r as any).created_at),
      status: ((r as any).status as string | null | undefined) ?? null,
      matched_session_id: ((r as any).matched_session_id as string | null | undefined) ?? null,
      intent_action: ((r as any).intent_action as string | null | undefined) ?? null,
      summary: ((r as any).summary as string | null | undefined) ?? null,

      // Session-based action evidence (from get_recent_intents_lite_v1)
      phone_clicks: typeof (r as any).phone_clicks === 'number' ? (r as any).phone_clicks : null,
      whatsapp_clicks: typeof (r as any).whatsapp_clicks === 'number' ? (r as any).whatsapp_clicks : null,
      intent_events: typeof (r as any).intent_events === 'number' ? (r as any).intent_events : null,

      // Traffic source (from sessions join)
      traffic_source: typeof (r as any).traffic_source === 'string' ? (r as any).traffic_source : null,
      traffic_medium: typeof (r as any).traffic_medium === 'string' ? (r as any).traffic_medium : null,
    })) as HunterIntentLite[];
}

