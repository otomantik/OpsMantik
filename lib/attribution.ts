/**
 * Attribution & Source Classification
 *
 * Computes attribution source based on GCLID, UTM, referrer, and past session data.
 * Priority order: S1 (GCLID) > S2 (UTM) > S3 (Ads Assisted) > S4 (Paid Social) > S5 (Organic)
 *
 * PR-OCI-7: Entropy Filter (anti-contamination) + DSA surrogate targeting.
 */

// PR-OCI-7.1: Sentinel values and template patterns for entropy filter
const SENTINEL_VALUES = new Set([
  'null', 'undefined', 'none', 'unknown', 'n/a', 'na', 'nil', '(not set)', '(none)',
  '{}', '[]', '"{}"', '"[]"',
]);
const TEMPLATE_PATTERN = /^(\{[a-z_]+\}|\{\{[a-z_]+\}\}|\[%[a-z_]+%\]|%7b[a-z_]+%7d)$/i;

function normalizeToken(v: string | null | undefined): string {
  if (v == null || typeof v !== 'string') return '';
  let s = v.trim();
  if (!s) return '';
  try {
    s = decodeURIComponent(s);
  } catch {
    // leave as-is on decode error
  }
  return s.trim().toLowerCase();
}

function isSentinelToken(v: string | null | undefined): boolean {
  const norm = normalizeToken(v);
  if (!norm) return true;
  if (SENTINEL_VALUES.has(norm)) return true;
  if (TEMPLATE_PATTERN.test(norm)) return true;
  if (/^%7b.*%7d$/i.test(norm) || norm.includes('{') && norm.includes('}')) return true;
  return false;
}

/**
 * PR-OCI-7.1.3: Sanitize click ID (gclid/wbraid/gbraid) - reject if suspicious.
 * Use for values from URL/meta before persisting; do not block existing DB values.
 */
export function sanitizeClickId(value: string | null | undefined): string | undefined {
  if (value == null || typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length < 10) return undefined;
  if (trimmed.includes('{') || trimmed.includes('}') || trimmed.includes('%7B') || trimmed.includes('%7b')) return undefined;
  return trimmed;
}

/**
 * PR-OCI-7.1: Sanitize URL param - return undefined for sentinel/template/empty.
 * Preserves original casing for storage.
 */
export function sanitizeParam(value: string | null | undefined): string | undefined {
  if (value == null || typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (isSentinelToken(trimmed)) return undefined;
  return trimmed;
}

/** Google Ads tracking template params: utm_*, device, devicemodel, targetid, network, adposition, feeditemid, loc_interest_ms, loc_physical_ms, matchtype */
export interface AttributionInput {
  gclid?: string | null;
  utm?: {
    medium?: string;
    source?: string;
    campaign?: string;
    term?: string;
    content?: string;
    adgroup?: string;   // Google Ads {adgroupid} → utm_adgroup
    matchtype?: string; // Google Ads {matchtype}: e=Exact, p=Phrase, b=Broad
    device?: string;    // Google Ads {device}: mobile, desktop, tablet
    device_model?: string; // Google Ads {devicemodel}
    network?: string;   // Google Ads {network}: Search, Display, YouTube, etc.
    placement?: string; // Google Ads {placement}
    adposition?: string;  // Google Ads {adposition}: ad position on page
    target_id?: string;   // Google Ads {targetid}
    feed_item_id?: string; // Google Ads {feeditemid}
    loc_interest_ms?: string; // Google Ads {loc_interest_ms}
    loc_physical_ms?: string; // Google Ads {loc_physical_ms}
  } | null;
  referrer?: string | null;
  fingerprint?: string | null;
  hasPastGclid?: boolean; // Whether past session had GCLID
}

export interface AttributionResult {
  source: string;
  isPaid: boolean;
}

/**
 * Compute attribution source based on input data
 * 
 * Priority order:
 * S1: GCLID present => "First Click (Paid)"
 * S2: UTM medium=cpc/ppc/paid => "Paid (UTM)"
 * S3: referrer contains google + past gclid => "Ads Assisted"
 * S4: referrer contains social domain => "Paid Social"
 * S5: else => "Organic"
 */
export function computeAttribution(input: AttributionInput): AttributionResult {
  const { gclid, utm, referrer, hasPastGclid } = input;

  // S1: First Click (Paid) - GCLID present
  if (gclid) {
    return {
      source: 'First Click (Paid)',
      isPaid: true,
    };
  }

  // S2: Paid (UTM) - UTM medium indicates paid
  if (utm?.medium) {
    const medium = utm.medium.toLowerCase();
    if (medium === 'cpc' || medium === 'ppc' || medium === 'paid') {
      return {
        source: 'Paid (UTM)',
        isPaid: true,
      };
    }
  }

  // S3: Ads Assisted - Google referrer + past GCLID
  if (referrer && hasPastGclid) {
    const refLower = referrer.toLowerCase();
    if (refLower.includes('google') || refLower.includes('googleads')) {
      return {
        source: 'Ads Assisted',
        isPaid: true,
      };
    }
  }

  // S4: Paid Social - Social media referrer
  if (referrer) {
    const refLower = referrer.toLowerCase();
    const socialDomains = ['facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'x.com'];
    if (socialDomains.some(domain => refLower.includes(domain))) {
      return {
        source: 'Paid Social',
        isPaid: true,
      };
    }
  }

  // S5: Organic (default)
  return {
    source: 'Organic',
    isPaid: false,
  };
}

/**
 * Extract UTM and Google Ads params from URL
 * Supports: utm_*, matchtype, device, network, placement (hesaptan şablon)
 * ROBUST: Also parses fragment-based query strings (e.g., #?utm_term=keyword)
 */
export function extractUTM(url: string): AttributionInput['utm'] | null {
  try {
    const urlObj = new URL(url);
    const params = new URLSearchParams(urlObj.search);

    // ROBUST: Parse fragment (#) when Google Ads (or SPA routers) place params after hash.
    // Seen formats:
    // - https://domain.com/?gclid=xxx#4?utm_term=keyword&matchtype=p
    // - https://domain.com/?gclid=xxx#utm_term=keyword&matchtype=e
    // - https://domain.com/#utm_source=google&utm_medium=cpc&utm_term=keyword
    if (urlObj.hash) {
      const rawHash = urlObj.hash.startsWith('#') ? urlObj.hash.slice(1) : urlObj.hash;
      const hash = rawHash.startsWith('?') ? rawHash.slice(1) : rawHash;

      // Prefer substring after the first '?', but also support hashes without '?'.
      const afterQuestion = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash;

      // Find where known keys start (sometimes hash has a prefix like "4" or route tokens).
      const keyStart = (() => {
        const re = /(?:^|[&#?])(utm_source|utm_medium|utm_campaign|utm_adgroup|utm_term|utm_content|matchtype|device|devicemodel|targetid|network|placement|adposition|feeditemid|loc_interest_ms|loc_physical_ms)=/i;
        const m1 = re.exec(afterQuestion);
        if (m1?.index != null) return m1.index;
        const m2 = /(utm_source|utm_medium|utm_campaign|utm_adgroup|utm_term|utm_content|matchtype|device|devicemodel|targetid|network|placement|adposition|feeditemid|loc_interest_ms|loc_physical_ms)=/i.exec(afterQuestion);
        return m2?.index ?? -1;
      })();

      if (keyStart >= 0) {
        const fragmentQuery = afterQuestion
          .slice(keyStart)
          .replace(/^[&#?]+/, '');
        if (fragmentQuery) {
          const fragmentParams = new URLSearchParams(fragmentQuery);
          // Merge fragment params into main params (fragment values take precedence)
          fragmentParams.forEach((value, key) => {
            params.set(key, value);
          });
        }
      }
    }

    const rawMedium = params.get('utm_medium');
    const rawSource = params.get('utm_source');
    const rawCampaign = params.get('utm_campaign');
    const rawAdgroup = params.get('utm_adgroup');
    const rawTerm = params.get('utm_term');
    const rawContent = params.get('utm_content');
    const rawMatchtype = params.get('matchtype');
    const rawDevice = params.get('device');
    const rawDevicemodel = params.get('devicemodel');
    const rawTargetid = params.get('targetid');
    const rawNetwork = params.get('network');
    const rawPlacement = params.get('placement');
    const rawAdposition = params.get('adposition');
    const rawFeeditemid = params.get('feeditemid');
    const rawLocInterestMs = params.get('loc_interest_ms');
    const rawLocPhysicalMs = params.get('loc_physical_ms');

    const medium = sanitizeParam(rawMedium) ?? undefined;
    const source = sanitizeParam(rawSource) ?? undefined;
    const campaign = sanitizeParam(rawCampaign) ?? undefined;
    const adgroup = sanitizeParam(rawAdgroup) ?? undefined;
    const content = sanitizeParam(rawContent) ?? undefined;
    const matchtype = sanitizeParam(rawMatchtype) ?? undefined;
    const device = sanitizeParam(rawDevice) ?? undefined;
    const devicemodel = sanitizeParam(rawDevicemodel) ?? undefined;
    const targetid = sanitizeParam(rawTargetid) ?? undefined;
    const network = sanitizeParam(rawNetwork) ?? undefined;
    const placement = sanitizeParam(rawPlacement) ?? undefined;
    const adposition = sanitizeParam(rawAdposition) ?? undefined;
    const feeditemid = sanitizeParam(rawFeeditemid) ?? undefined;
    const locInterestMs = sanitizeParam(rawLocInterestMs) ?? undefined;
    const locPhysicalMs = sanitizeParam(rawLocPhysicalMs) ?? undefined;

    // PR-OCI-7 DSA surrogate: when utm_term empty, use content, placement, or landing path; prefix dsa:, truncate to 120 chars
    let term = sanitizeParam(rawTerm) ?? undefined;
    if (!term) {
      const c = sanitizeParam(rawContent);
      if (c) term = `dsa:${c}`.slice(0, 120);
      else {
        const p = sanitizeParam(rawPlacement);
        if (p) term = `dsa:${p}`.slice(0, 120);
        else {
          const path = urlObj.pathname?.replace(/^\/+|\/+$/g, '').slice(0, 120);
          if (path) term = `dsa:${path}`;
        }
      }
    }

    if (!medium && !source && !campaign && !adgroup && !term && !content && !matchtype && !device && !devicemodel && !targetid && !network && !placement && !adposition && !feeditemid && !locInterestMs && !locPhysicalMs) {
      return null;
    }

    return {
      medium,
      source,
      campaign,
      adgroup,
      term,
      content,
      matchtype,
      device,
      device_model: devicemodel,
      target_id: targetid,
      network,
      placement,
      adposition,
      feed_item_id: feeditemid,
      loc_interest_ms: locInterestMs,
      loc_physical_ms: locPhysicalMs,
    };
  } catch {
    return null;
  }
}

/** Session UTM state (current values from DB). */
export interface SessionUtmState {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  utm_adgroup?: string | null;
  ads_network?: string | null;
  ads_placement?: string | null;
  ads_adposition?: string | null;
  matchtype?: string | null;
  device_model?: string | null;
  ads_target_id?: string | null;
  ads_feed_item_id?: string | null;
  loc_interest_ms?: string | number | null;
  loc_physical_ms?: string | number | null;
}

/** Incoming UTM from attribution (e.g. from URL). */
export interface IncomingUtm {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  term?: string | null;
  content?: string | null;
  adgroup?: string | null;
  matchtype?: string | null;
  network?: string | null;
  placement?: string | null;
  adposition?: string | null;
  device_model?: string | null;
  target_id?: string | null;
  feed_item_id?: string | null;
  loc_interest_ms?: string | null;
  loc_physical_ms?: string | null;
}

/**
 * PR-OCI-7.1: Compute UTM field updates for session.
 * - Overwrite only on strict upgrade (newWeight > currentWeight).
 * - Enrichment (NULL → value) always allowed.
 * - No overwrite when equal weight (e.g. Paid → Paid).
 */
export function computeUtmUpdates(
  session: SessionUtmState,
  incoming: IncomingUtm | null | undefined,
  isUpgrade: boolean
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!incoming) return out;

  const setIfAllowed = (field: string, sessionVal: string | number | null | undefined, incomingVal: string | number | null | undefined) => {
    if (incomingVal == null || (typeof incomingVal === 'string' && incomingVal === '')) return;
    const hasExisting = sessionVal != null && (typeof sessionVal !== 'string' || sessionVal !== '');
    if (hasExisting && !isUpgrade) return;
    out[field] = incomingVal;
  };

  setIfAllowed('utm_source', session.utm_source, incoming.source);
  setIfAllowed('utm_medium', session.utm_medium, incoming.medium);
  setIfAllowed('utm_campaign', session.utm_campaign, incoming.campaign);
  setIfAllowed('utm_term', session.utm_term, incoming.term);
  setIfAllowed('utm_content', session.utm_content, incoming.content);
  setIfAllowed('utm_adgroup', session.utm_adgroup, incoming.adgroup);
  setIfAllowed('ads_network', session.ads_network, incoming.network);
  setIfAllowed('ads_placement', session.ads_placement, incoming.placement);
  setIfAllowed('ads_adposition', session.ads_adposition, incoming.adposition);
  setIfAllowed('matchtype', session.matchtype, incoming.matchtype);
  setIfAllowed('device_model', session.device_model, incoming.device_model);
  setIfAllowed('ads_target_id', session.ads_target_id, incoming.target_id);
  setIfAllowed('ads_feed_item_id', session.ads_feed_item_id, incoming.feed_item_id);
  setIfAllowed('loc_interest_ms', session.loc_interest_ms, incoming.loc_interest_ms);
  setIfAllowed('loc_physical_ms', session.loc_physical_ms, incoming.loc_physical_ms);
  return out;
}
