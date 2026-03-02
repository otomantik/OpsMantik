/**
 * Traffic de-bloat gates: bot UA detection and referrer allowlist/blocklist.
 * Site-scoped via config; used before runSyncGates when traffic_debloat is enabled.
 */

/** Hard bots: always skip (crawlers, headless, monitoring). */
const HARD_BOT_PATTERNS = [
  /bot\b/i,
  /crawler/i,
  /spider/i,
  /slurp/i,
  /headless/i,
  /phantom/i,
  /lighthouse/i,
  /pagespeed/i,
  /monitoring/i,
  /uptime/i,
  /httpclient/i,
  /\bcurl\b/i,
  /\bwget\b/i,
];

/** Preview bots: link preview fetchers; skip unless ingest_allow_preview_uas. */
const PREVIEW_BOT_PATTERNS = [
  /facebookexternalhit/i,
  /whatsapp/i,
  /telegrambot/i,
  /discordbot/i,
  /slackbot/i,
];

export interface IsCommonBotUAOptions {
  /** When true, do not treat preview UAs (WhatsApp, FB, Telegram) as bot. */
  allowPreviewUAs?: boolean;
}

/**
 * Returns true if UA looks like a common bot/crawler.
 * Two tiers: hard bots always match; preview bots match unless allowPreviewUAs.
 */
export function isCommonBotUA(ua: string | null | undefined, options?: IsCommonBotUAOptions): boolean {
  if (ua == null || typeof ua !== 'string') return false;
  const allowPreview = options?.allowPreviewUAs === true;

  for (const re of HARD_BOT_PATTERNS) {
    if (re.test(ua)) return true;
  }
  if (!allowPreview) {
    for (const re of PREVIEW_BOT_PATTERNS) {
      if (re.test(ua)) return true;
    }
  }
  return false;
}

const MIN_CLICK_ID_LENGTH = 10;

/**
 * Valid click-id for Ads attribution / referrer bypass: present and not junk (e.g. gclid=1).
 */
export function hasValidClickId(payload: {
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
}): boolean {
  const g = payload.gclid != null && String(payload.gclid).trim().length >= MIN_CLICK_ID_LENGTH;
  const w = payload.wbraid != null && String(payload.wbraid).trim().length >= MIN_CLICK_ID_LENGTH;
  const b = payload.gbraid != null && String(payload.gbraid).trim().length >= MIN_CLICK_ID_LENGTH;
  return g || w || b;
}

/** Default allowlist: common search/social (lowercase host suffixes). */
const DEFAULT_REFERRER_ALLOWLIST = [
  'google.',
  'bing.',
  'duckduckgo.',
  'facebook.',
  'instagram.',
  't.co',
  'twitter.',
  'linkedin.',
  'tiktok.',
  'youtube.',
  'yandex.',
];

/** Default blocklist: known gambling/suspicious (lowercase). */
const DEFAULT_REFERRER_BLOCKLIST: string[] = [
  // extendable via config
];

export interface IsAllowedReferrerConfig {
  allowlist?: string[];
  blocklist?: string[];
  /** Event URL host (normalized) for same-site check. */
  eventHost: string;
}

/**
 * Normalize host for comparison: lowercase, strip leading www.
 */
function normalizeHost(host: string): string {
  const h = host.trim().toLowerCase();
  return h.startsWith('www.') ? h.slice(4) : h;
}

/**
 * eTLD+1 approximation: return registered domain (strip subdomains for same-site).
 * Minimal: strip www only; no full PSL. For same-site we compare normalized hosts;
 * if one is subdomain of the other (e.g. m.site.com vs www.site.com), treat as same if base matches.
 */
function getBaseHost(host: string): string {
  const n = normalizeHost(host);
  const parts = n.split('.');
  if (parts.length >= 2) return parts.slice(-2).join('.');
  return n;
}

/**
 * Returns true if referrer is allowed: no referrer (direct), same-site, or in allowlist.
 * Blocklist wins over allowlist.
 */
export function isAllowedReferrer(
  referrer: string | null | undefined,
  eventUrl: string,
  config: IsAllowedReferrerConfig
): boolean {
  if (referrer == null || referrer.trim() === '') return true;

  let referrerHost: string;
  try {
    const u = new URL(referrer);
    referrerHost = u.hostname || '';
  } catch {
    return false;
  }
  if (!referrerHost) return true;

  let eventHost = '';
  try {
    const u = new URL(eventUrl);
    eventHost = u.hostname || '';
  } catch {
    eventHost = config.eventHost || '';
  }
  const normEvent = normalizeHost(eventHost);
  const normRef = normalizeHost(referrerHost);

  // Same-site: exact match or eTLD+1
  if (normRef === normEvent) return true;
  if (getBaseHost(referrerHost) === getBaseHost(eventHost)) return true;

  const blocklist = config.blocklist ?? DEFAULT_REFERRER_BLOCKLIST;
  for (const b of blocklist) {
    if (normRef.includes(b.toLowerCase()) || normRef.endsWith(b.toLowerCase())) return false;
  }

  const allowlist = config.allowlist?.length ? config.allowlist : DEFAULT_REFERRER_ALLOWLIST;
  for (const a of allowlist) {
    const suffix = a.toLowerCase();
    if (normRef === suffix || normRef.endsWith('.' + suffix) || normRef.includes(suffix)) return true;
  }

  return false;
}
