/**
 * HunterCard v3 (Predator HUD) – intent type and match-type decoding.
 * RPC get_recent_intents_v2 returns utm_term, matchtype, city, district, device_type from session.
 */

/** Google Ads match type raw: e=Exact, p=Phrase, b=Broad */
export type HunterMatchTypeRaw = 'e' | 'p' | 'b' | string;

/** Decoded match intent for UI badges (Exact = High Intent, Broad = Medium) */
export type HunterMatchIntentType = 'exact' | 'phrase' | 'broad' | 'unknown';

/**
 * Lite intent payload for queue/list views.
 * Used with get_recent_intents_lite_v1 (cheap RPC) + lazy details fetch.
 */
export interface HunterIntentLite {
  id: string;
  created_at: string;
  status?: string | null;
  matched_session_id?: string | null;
  intent_action?: 'whatsapp' | 'phone' | 'form' | 'other' | string | null;
  /** A brief text summary for list UI (e.g. intent_target or action). */
  summary?: string | null;
}

/** Unified Hunter Intent (v3) - Single source of truth */
export interface HunterIntent {
  id: string;
  created_at: string;
  intent_action?: 'whatsapp' | 'phone' | 'form' | 'other' | string | null;
  intent_target?: string | null;

  // Search & attribution (INTEL BOX)
  page_url?: string | null;
  intent_page_url?: string | null;
  utm_term?: string | null;
  utm_campaign?: string | null;
  utm_campaign_id?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_content?: string | null;
  matchtype?: string | null;

  // Geo (TARGET HUD)
  city?: string | null;
  district?: string | null;

  // Device (TARGET HUD)
  device_type?: string | null;
  device_os?: string | null;
  browser?: string | null;
  device_model?: string | null;
  browser_language?: string | null;
  device_memory?: number | null;
  hardware_concurrency?: number | null;
  screen_width?: number | null;
  screen_height?: number | null;
  pixel_ratio?: number | null;
  gpu_renderer?: string | null;
  connection_type?: string | null;
  is_returning?: boolean | null;
  visitor_rank?: string | null;
  previous_visit_count?: number | null;
  referrer_host?: string | null;
  network?: string | null;
  telco_carrier?: string | null;
  isp_asn?: string | null;
  is_proxy_detected?: boolean | null;
  ads_network?: string | null;
  ads_placement?: string | null;
  // Behavior (Action Pulse)
  max_scroll_percentage?: number | null;
  cta_hover_count?: number | null;
  form_focus_duration?: number | null;
  total_active_seconds?: number | null;
  engagement_score?: number | null;

  // Financial & AI
  estimated_value?: number | null;
  currency?: string | null;
  lead_score?: number | null;
  ai_score?: number | null;
  ai_summary?: string | null;
  ai_tags?: string[] | null;

  // Metadata
  intent_stamp?: string | null;
  risk_level?: 'low' | 'high' | string | null;
  risk_reasons?: string[] | null;
  total_duration_sec?: number | null;
  click_id?: string | null;
  matched_session_id?: string | null;
  status?: string | null;
  event_count?: number | null;

  // OCI/Backend
  oci_status?: string | null;
  oci_status_updated_at?: string | null;
  oci_uploaded_at?: string | null;
  oci_batch_id?: string | null;
  oci_error?: string | null;
  oci_matchable?: boolean;
  oci_stage?: string | null;
  attribution_source?: string | null;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
}

export interface HunterCardV3Props {
  intent: HunterIntent;
  siteId?: string;
  onSeal?: (intent: HunterIntent) => void;
  onJunk?: (intent: HunterIntent, reason?: string) => void;
  onWhatsApp?: (intent: HunterIntent) => void;
}

/**
 * Decode Google Ads matchtype (e/p/b) to display label and intent level.
 * e=Exact => High Intent (Fire), b=Broad => Medium, p=Phrase => Medium-High.
 */
export function decodeMatchType(matchtype: string | null | undefined): {
  type: HunterMatchIntentType;
  label: string;
  highIntent: boolean;
} {
  if (!matchtype || typeof matchtype !== 'string') {
    return { type: 'unknown', label: '—', highIntent: false };
  }
  const raw = matchtype.toLowerCase().trim();
  if (raw === 'e') return { type: 'exact', label: 'Exact Match', highIntent: true };
  if (raw === 'p') return { type: 'phrase', label: 'Phrase', highIntent: false };
  if (raw === 'b') return { type: 'broad', label: 'Broad', highIntent: false };
  return { type: 'unknown', label: raw || '—', highIntent: false };
}
