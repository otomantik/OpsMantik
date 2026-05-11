/**
 * OpsMantik Google Ads OCI - Koc Oto Kurtarma script.
 *
 * Paste into Google Ads Script Editor (entry `main`).
 * Runtime: Chrome V8 (“new script experience”) ON — ES6/`Set`/arrow styles require it.
 *
 * Credentials (Script Properties preferred):
 * - OPSMANTIK_SITE_ID, OPSMANTIK_API_KEY, OPSMANTIK_BASE_URL (optional)
 * - OPSMANTIK_RUN_MODE — `peek` | `sync` (Script Properties override file-level `OPSMANTIK_RUN_MODE`; optional `OPSMANTIK_INLINE_RUN_MODE`)
 *
 * Google platform limits / ops (not enforced by OpsMantik code alone):
 * - Hard ceiling ~30 min execution — use `OPSMANTIK_MAX_RUNTIME_MS` (default ~25 min) plus smaller,
 *   more frequent triggers if the backlog is huge.
 * - Offline conversion Bulk Upload CSV: “Conversion name” must match Ads UI exactly (case, spaces).
 * - Hashed phone column (`OPSMANTIK_HASHED_PHONE_CSV_COLUMN`): header must match Google’s offline import
 *   template verbatim or `upload.apply()` may reject the file.
 * - PR-9I Script path supports universal click-id selection: gclid > wbraid > gbraid (exactly one upload column populated).
 *
 * Operational safety (inline / Script Properties — see `DEFAULT_*` in source):
 * - OPSMANTIK_EXPORT_LIMIT — keep aligned with PR-9I broad drain max batch (e.g. 25).
 * - OPSMANTIK_MAX_SYNC_PAGES — sync claim loop page cap (Koç canlı drain: 1 sayfa kontrollü).
 * - OPSMANTIK_MAX_PEEK_PAGES — peek pagination cap (PEEK öncesi: 1 sayfa yeter).
 * - OPSMANTIK_MAX_RUNTIME_MS — bail out before Google's wall clock (default 1500000 ≈ 25 min).
 *
 * Run modes:
 * - "peek": queue preview only, no upload/ack (`markAsExportedSunucu=false`)
 * - "sync": upload + ack/ack-failed flow
 *
 * Koç canlı drain (PR-9I, ~22 satır) — önerilen sıra:
 * 1) `OPSMANTIK_RUN_MODE=peek`, `OPSMANTIK_EXPORT_LIMIT=25`, `OPSMANTIK_MAX_SYNC_PAGES` / `OPSMANTIK_MAX_PEEK_PAGES=1`.
 *    Beklenen: `satirBuSayfa` ~22, `hp=1` ~17 / `hp=0` ~5, g/w/gb bayrakları, `markAsExportedSunucu=false`.
 * 2) Sonra yalnızca `OPSMANTIK_RUN_MODE=sync` (limit ve sayfa sigortası aynı kalsın).
 * 3) Başarı logları: `Sayfa sync` fetched=uploaded, failed=0; `SCRIPT_SUMMARY_RECONCILED`; `SYNC_HIT_MAX_SYNC_PAGES_FUSE_MORE_QUEUE_REMAINS`
 *    tek başına hata değil (MAX_SYNC_PAGES=1 bilinçli sigorta). Evidence etiketi: **PR9I_KOC_LIVE_QUEUE_DRAIN_22_SUCCESS**.
 *
 * Hashed phone (courier only; PR-9H.7A) + canlı drain:
 * - `OPSMANTIK_INCLUDE_HASHED_PHONE_IN_UPLOAD=true` + sütun başlığı — script ham telefon görmez, hash loglamaz.
 * - `OPSMANTIK_HASHED_PHONE_CSV_CANARY_MODE` **boş/false** → tek satırlık PR-9H.7B canary zorunluluğu yok; geniş SYNC + drain onayı kullanılır.
 *
 * PR-9H.7B canary (tek kuyruk, LIMIT=1): `OPSMANTIK_HASHED_PHONE_CSV_CANARY_MODE=true`,
 * `OPSMANTIK_EXPORT_ALLOWLIST_IDS` (tek UUID), `OPSMANTIK_CANARY_EXPECTED_QUEUE_ID`, canary onay token’ları.
 * **SYNC:** `OPSMANTIK_ALLOWLIST_IDS` yasak (claim-then-drop). Geniş drain’de allowlist/canary alanları boş.
 *
 * PR-9I broad drain gate (mutating claim, allowlist yok):
 * - Script bu repoda `x-opsmantik-drain-*` header’larını gönderir (`OPSMANTIK_INLINE_DRAIN_*` veya Script Properties `OPSMANTIK_DRAIN_*`).
 * - Alternatif: Vercel’de `OPSMANTIK_DRAIN_APPROVAL`, `OPSMANTIK_DRAIN_SITE_ID`, `OPSMANTIK_DRAIN_MAX_BATCH_SIZE`, `OPSMANTIK_DRAIN_INCLUDE_BRAIDS`.
 * - `409` + `SCRIPT_DRAIN_BLOCKED` → hiçbir satır claim edilmemiştir; header veya sunucu env’yi tamamlayın.
 *
 * **Never commit `OPSMANTIK_INLINE_API_KEY`** — leave empty; set `OPSMANTIK_API_KEY` only in Script Properties.
 */

'use strict';

var HASHED_PHONE_EXPORT_MISSING = 'HASHED_PHONE_EXPORT_MISSING';
var HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE = 'HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE';

/** Set in `mainSyncKocOto` when sync + hashed-phone upload uses PR-9H.7B canary fetch. */
var RESOLVED_HP_CANARY_QUEUE_ID = '';

/** Fuse values — override via OPSMANTIK_MAX_* Script Properties when backlog/trigger cadence warrants it. */
var DEFAULT_MAX_SYNC_PAGES = 40;
var DEFAULT_MAX_PEEK_PAGES = 120;
var DEFAULT_MAX_RUNTIME_MS = 1500000;

/**
 * @type {string} peek | sync — Script Properties `OPSMANTIK_RUN_MODE` wins when set.
 * Repo default `peek`: canlı SYNC öncesi bir kez PEEK doğrula, sonra yalnızca bunu `sync` yap.
 */
var OPSMANTIK_RUN_MODE = 'peek';

/** Optional inline run mode (empty → Properties / global `OPSMANTIK_RUN_MODE`). */
var OPSMANTIK_INLINE_RUN_MODE = '';

/** @type {string} sites.public_id — Koc Oto Kurtarma */
var OPSMANTIK_INLINE_SITE_ID = '93cb9966bcf349c1b4ece8ea34142ace';

/** @type {string} sites.oci_api_key — leave EMPTY in repo; set OPSMANTIK_API_KEY in Script Properties only */
var OPSMANTIK_INLINE_API_KEY = '';

/** @type {string} hosted console API origin */
var OPSMANTIK_INLINE_BASE_URL = 'https://console.opsmantik.com';

/** @type {string} Tek istekte claim limiti — `OPSMANTIK_INLINE_DRAIN_MAX_BATCH_SIZE` ile aynı sayı olmalı (sunucu SCRIPT_DRAIN gate). */
var OPSMANTIK_INLINE_EXPORT_LIMIT = '100';

/** @type {string} SYNC: leave empty (client allowlist forbidden). PEEK: optional */
var OPSMANTIK_INLINE_ALLOWLIST_IDS = '';

var OPSMANTIK_INLINE_INCLUDE_HASHED_PHONE_IN_UPLOAD = 'true';
/** Set in Script Properties to Google Bulk Upload exact header, or fill here after template verify */
var OPSMANTIK_INLINE_HASHED_PHONE_CSV_COLUMN = 'Hashed Phone Number';
/** Boş = canlı drain (geniş SYNC). `true` + LIMIT=1 + allowlist = PR-9H.7B tek satır canary. */
var OPSMANTIK_INLINE_HASHED_PHONE_CSV_CANARY_MODE = '';
var OPSMANTIK_INLINE_EXPORT_ALLOWLIST_IDS = '';
var OPSMANTIK_INLINE_CANARY_EXPECTED_QUEUE_ID = '';
var OPSMANTIK_INLINE_CANARY_APPROVAL = '';
var OPSMANTIK_INLINE_CANARY_UPLOAD_APPROVAL = '';
var OPSMANTIK_INLINE_OPERATOR_ID = 'serkan';
var OPSMANTIK_INLINE_CHANGE_TICKET = 'PR-9I-KOC-LIVE-DRAIN-ALL-22';
/** Tek sayfa sigortası — SYNC kontrollü batch (kalan kuyruk sonraki tetikleme) */
var OPSMANTIK_INLINE_MAX_SYNC_PAGES = '1';
/**
 * PEEK: sunucu kuyruğu `updated_at` artan sıralar; ilk sayfada çoğu Won birikmiş olabilir.
 * Contacted/Offered/Junk sonraki sayfalarda — PEEK’te en az 8 sayfa önerilir (SYNC sigortasından bağımsız).
 */
var OPSMANTIK_INLINE_MAX_PEEK_PAGES = '8';
var OPSMANTIK_INLINE_MAX_RUNTIME_MS = '';

/**
 * PR-9I broad mutating drain — SYNC claim’de (canary kapalıyken) gönderilir.
 * Sunucuda env ile de verilebilir; ikisi birlikte kullanılabilir.
 */
var OPSMANTIK_INLINE_DRAIN_APPROVAL = 'I_APPROVE_SCRIPT_DRAIN';
var OPSMANTIK_INLINE_DRAIN_SITE_ID = '93cb9966bcf349c1b4ece8ea34142ace';
/** İstek `limit` değerinden küçük olmamalı; EXPORT_LIMIT ile aynı tutun (ör. ikisi de 100). */
var OPSMANTIK_INLINE_DRAIN_MAX_BATCH_SIZE = '100';
var OPSMANTIK_INLINE_DRAIN_INCLUDE_BRAIDS = 'true';

/** Optional inline CSV header for hashed phone (overrides Script Property when non-empty). */
var HASHED_PHONE_UPLOAD_COLUMN = '';

function stripKnownExportQueuePrefix(idStr) {
  const s = idStr != null ? String(idStr).trim() : '';
  if (!s) return '';
  const prefixes = ['seal_', 'won_', 'contacted_', 'offered_', 'junk_exclusion_', 'junk_'];
  for (let i = 0; i < prefixes.length; i++) {
    const p = prefixes[i];
    if (s.indexOf(p) === 0) return s.slice(p.length);
  }
  return s;
}

/** Peek log: avoid full canonical queue/export id leakage. */
function peekRedactQueueIdSnippet(rawId) {
  const s = rawId != null ? String(rawId).trim() : '';
  if (!s) return '';
  if (s.length <= 12) return s.charAt(0) + '…' + s.slice(-2);
  return s.slice(0, 8) + '…' + s.slice(-6);
}

/** Client-side peek filter: match raw export id (`seal_<uuid>`) or canonical queue UUID. */
function queueIdMatchesAllowlist(rowId, allowlistSet) {
  if (!rowId || !allowlistSet) return false;
  const raw = String(rowId).trim();
  const canon = stripKnownExportQueuePrefix(raw);
  return allowlistSet.has(raw) || allowlistSet.has(canon);
}

function getInlineForKeys(keys) {
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (
      (key === 'OPSMANTIK_SITE_ID' || key === 'OCI_SITE_ID') &&
      typeof OPSMANTIK_INLINE_SITE_ID === 'string' &&
      OPSMANTIK_INLINE_SITE_ID.trim()
    ) {
      return OPSMANTIK_INLINE_SITE_ID.trim();
    }
    if (
      (key === 'OPSMANTIK_API_KEY' || key === 'OCI_API_KEY') &&
      typeof OPSMANTIK_INLINE_API_KEY === 'string' &&
      OPSMANTIK_INLINE_API_KEY.trim()
    ) {
      return OPSMANTIK_INLINE_API_KEY.trim();
    }
    if (
      (key === 'OPSMANTIK_BASE_URL' || key === 'OCI_BASE_URL') &&
      typeof OPSMANTIK_INLINE_BASE_URL === 'string' &&
      OPSMANTIK_INLINE_BASE_URL.trim()
    ) {
      return OPSMANTIK_INLINE_BASE_URL.trim();
    }
    if (
      key === 'OPSMANTIK_EXPORT_LIMIT' &&
      typeof OPSMANTIK_INLINE_EXPORT_LIMIT === 'string' &&
      OPSMANTIK_INLINE_EXPORT_LIMIT.trim()
    ) {
      return OPSMANTIK_INLINE_EXPORT_LIMIT.trim();
    }
    if (
      (key === 'OPSMANTIK_RUN_MODE' || key === 'OPSMANTIK_RUNMODE') &&
      typeof OPSMANTIK_INLINE_RUN_MODE === 'string' &&
      OPSMANTIK_INLINE_RUN_MODE.trim()
    ) {
      return OPSMANTIK_INLINE_RUN_MODE.trim();
    }
    if (
      key === 'OPSMANTIK_ALLOWLIST_IDS' &&
      typeof OPSMANTIK_INLINE_ALLOWLIST_IDS === 'string' &&
      OPSMANTIK_INLINE_ALLOWLIST_IDS.trim()
    ) {
      return OPSMANTIK_INLINE_ALLOWLIST_IDS.trim();
    }
    if (
      key === 'OPSMANTIK_INCLUDE_HASHED_PHONE_IN_UPLOAD' &&
      typeof OPSMANTIK_INLINE_INCLUDE_HASHED_PHONE_IN_UPLOAD === 'string' &&
      OPSMANTIK_INLINE_INCLUDE_HASHED_PHONE_IN_UPLOAD.trim()
    ) {
      return OPSMANTIK_INLINE_INCLUDE_HASHED_PHONE_IN_UPLOAD.trim();
    }
    if (
      key === 'OPSMANTIK_HASHED_PHONE_CSV_COLUMN' &&
      typeof OPSMANTIK_INLINE_HASHED_PHONE_CSV_COLUMN === 'string' &&
      OPSMANTIK_INLINE_HASHED_PHONE_CSV_COLUMN.trim()
    ) {
      return OPSMANTIK_INLINE_HASHED_PHONE_CSV_COLUMN.trim();
    }
    if (
      key === 'OPSMANTIK_HASHED_PHONE_CSV_CANARY_MODE' &&
      typeof OPSMANTIK_INLINE_HASHED_PHONE_CSV_CANARY_MODE === 'string' &&
      OPSMANTIK_INLINE_HASHED_PHONE_CSV_CANARY_MODE.trim()
    ) {
      return OPSMANTIK_INLINE_HASHED_PHONE_CSV_CANARY_MODE.trim();
    }
    if (
      key === 'OPSMANTIK_EXPORT_ALLOWLIST_IDS' &&
      typeof OPSMANTIK_INLINE_EXPORT_ALLOWLIST_IDS === 'string' &&
      OPSMANTIK_INLINE_EXPORT_ALLOWLIST_IDS.trim()
    ) {
      return OPSMANTIK_INLINE_EXPORT_ALLOWLIST_IDS.trim();
    }
    if (
      key === 'OPSMANTIK_CANARY_EXPECTED_QUEUE_ID' &&
      typeof OPSMANTIK_INLINE_CANARY_EXPECTED_QUEUE_ID === 'string' &&
      OPSMANTIK_INLINE_CANARY_EXPECTED_QUEUE_ID.trim()
    ) {
      return OPSMANTIK_INLINE_CANARY_EXPECTED_QUEUE_ID.trim();
    }
    if (
      key === 'OPSMANTIK_CANARY_APPROVAL' &&
      typeof OPSMANTIK_INLINE_CANARY_APPROVAL === 'string' &&
      OPSMANTIK_INLINE_CANARY_APPROVAL.trim()
    ) {
      return OPSMANTIK_INLINE_CANARY_APPROVAL.trim();
    }
    if (
      (key === 'OPSMANTIK_CANARY_UPLOAD_APPROVAL' || key === 'CANARY_UPLOAD_APPROVAL') &&
      typeof OPSMANTIK_INLINE_CANARY_UPLOAD_APPROVAL === 'string' &&
      OPSMANTIK_INLINE_CANARY_UPLOAD_APPROVAL.trim()
    ) {
      return OPSMANTIK_INLINE_CANARY_UPLOAD_APPROVAL.trim();
    }
    if (
      key === 'OPSMANTIK_OPERATOR_ID' &&
      typeof OPSMANTIK_INLINE_OPERATOR_ID === 'string' &&
      OPSMANTIK_INLINE_OPERATOR_ID.trim()
    ) {
      return OPSMANTIK_INLINE_OPERATOR_ID.trim();
    }
    if (
      key === 'OPSMANTIK_CHANGE_TICKET' &&
      typeof OPSMANTIK_INLINE_CHANGE_TICKET === 'string' &&
      OPSMANTIK_INLINE_CHANGE_TICKET.trim()
    ) {
      return OPSMANTIK_INLINE_CHANGE_TICKET.trim();
    }
    if (
      key === 'OPSMANTIK_MAX_SYNC_PAGES' &&
      typeof OPSMANTIK_INLINE_MAX_SYNC_PAGES === 'string' &&
      OPSMANTIK_INLINE_MAX_SYNC_PAGES.trim()
    ) {
      return OPSMANTIK_INLINE_MAX_SYNC_PAGES.trim();
    }
    if (
      key === 'OPSMANTIK_MAX_PEEK_PAGES' &&
      typeof OPSMANTIK_INLINE_MAX_PEEK_PAGES === 'string' &&
      OPSMANTIK_INLINE_MAX_PEEK_PAGES.trim()
    ) {
      return OPSMANTIK_INLINE_MAX_PEEK_PAGES.trim();
    }
    if (
      key === 'OPSMANTIK_MAX_RUNTIME_MS' &&
      typeof OPSMANTIK_INLINE_MAX_RUNTIME_MS === 'string' &&
      OPSMANTIK_INLINE_MAX_RUNTIME_MS.trim()
    ) {
      return OPSMANTIK_INLINE_MAX_RUNTIME_MS.trim();
    }
    if (
      key === 'OPSMANTIK_DRAIN_APPROVAL' &&
      typeof OPSMANTIK_INLINE_DRAIN_APPROVAL === 'string' &&
      OPSMANTIK_INLINE_DRAIN_APPROVAL.trim()
    ) {
      return OPSMANTIK_INLINE_DRAIN_APPROVAL.trim();
    }
    if (
      key === 'OPSMANTIK_DRAIN_SITE_ID' &&
      typeof OPSMANTIK_INLINE_DRAIN_SITE_ID === 'string' &&
      OPSMANTIK_INLINE_DRAIN_SITE_ID.trim()
    ) {
      return OPSMANTIK_INLINE_DRAIN_SITE_ID.trim();
    }
    if (
      key === 'OPSMANTIK_DRAIN_MAX_BATCH_SIZE' &&
      typeof OPSMANTIK_INLINE_DRAIN_MAX_BATCH_SIZE === 'string' &&
      OPSMANTIK_INLINE_DRAIN_MAX_BATCH_SIZE.trim()
    ) {
      return OPSMANTIK_INLINE_DRAIN_MAX_BATCH_SIZE.trim();
    }
    if (
      key === 'OPSMANTIK_DRAIN_INCLUDE_BRAIDS' &&
      typeof OPSMANTIK_INLINE_DRAIN_INCLUDE_BRAIDS === 'string' &&
      OPSMANTIK_INLINE_DRAIN_INCLUDE_BRAIDS.trim()
    ) {
      return OPSMANTIK_INLINE_DRAIN_INCLUDE_BRAIDS.trim();
    }
  }
  return '';
}

function getScriptConfig() {
  let props = null;
  try {
    if (typeof PropertiesService !== 'undefined') {
      props = PropertiesService.getScriptProperties();
    }
  } catch (e) {
    /* ignore */
  }
  const getFirst = function (keys, fallback) {
    const inline = getInlineForKeys(keys);
    if (inline) return inline;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (props && props.getProperty && props.getProperty(key)) {
        return props.getProperty(key);
      }
      if (typeof process !== 'undefined' && process.env && process.env[key]) {
        return process.env[key];
      }
    }
    return fallback || '';
  };

  const limitRaw = getFirst(['OPSMANTIK_EXPORT_LIMIT'], '200');
  const limitNum = parseInt(String(limitRaw), 10);
  const limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.min(1000, limitNum) : 200;

  const includeHpRaw = getFirst(['OPSMANTIK_INCLUDE_HASHED_PHONE_IN_UPLOAD'], '');
  const csvCanaryRaw = getFirst(['OPSMANTIK_HASHED_PHONE_CSV_CANARY_MODE'], '');

  const maxSyncRaw = getFirst(['OPSMANTIK_MAX_SYNC_PAGES'], String(DEFAULT_MAX_SYNC_PAGES));
  const maxPeekRaw = getFirst(['OPSMANTIK_MAX_PEEK_PAGES'], String(DEFAULT_MAX_PEEK_PAGES));
  const maxClockRaw = getFirst(['OPSMANTIK_MAX_RUNTIME_MS'], String(DEFAULT_MAX_RUNTIME_MS));
  const maxSyncNum = parseInt(String(maxSyncRaw), 10);
  const maxPeekNum = parseInt(String(maxPeekRaw), 10);
  const maxClockNum = parseInt(String(maxClockRaw), 10);
  const MAX_SYNC_PAGES =
    Number.isFinite(maxSyncNum) && maxSyncNum > 0 ? Math.min(5000, Math.max(1, maxSyncNum)) : DEFAULT_MAX_SYNC_PAGES;
  const MAX_PEEK_PAGES =
    Number.isFinite(maxPeekNum) && maxPeekNum > 0 ? Math.min(5000, Math.max(1, maxPeekNum)) : DEFAULT_MAX_PEEK_PAGES;
  const MAX_RUNTIME_MS =
    Number.isFinite(maxClockNum) && maxClockNum >= 120000 ? Math.min(1790000, maxClockNum) : DEFAULT_MAX_RUNTIME_MS;

  const drainMaxRaw = getFirst(['OPSMANTIK_DRAIN_MAX_BATCH_SIZE'], '');
  const drainMaxNum = parseInt(String(drainMaxRaw), 10);
  const DRAIN_MAX_BATCH_NUM =
    Number.isFinite(drainMaxNum) && drainMaxNum > 0 ? Math.min(1000, Math.max(1, drainMaxNum)) : 0;

  const isLocal = typeof require !== 'undefined' && require.main && require.main === module;

  return Object.freeze({
    SITE_ID: getFirst(['OPSMANTIK_SITE_ID', 'OCI_SITE_ID'], '') || (isLocal ? 'mock-public-id' : ''),
    API_KEY: getFirst(['OPSMANTIK_API_KEY', 'OCI_API_KEY'], '') || (isLocal ? 'mock-key' : ''),
    BASE_URL: getFirst(['OPSMANTIK_BASE_URL', 'OCI_BASE_URL'], '') || 'https://console.opsmantik.com',
    ALLOWLIST_IDS: getFirst(['OPSMANTIK_ALLOWLIST_IDS'], ''),
    LIMIT: limit,
    INCLUDE_HASHED_PHONE_IN_UPLOAD: /^true$/i.test(String(includeHpRaw || '').trim()),
    HASHED_PHONE_CSV_COLUMN: getFirst(['OPSMANTIK_HASHED_PHONE_CSV_COLUMN'], ''),
    HASHED_PHONE_CSV_CANARY_MODE: /^true$/i.test(String(csvCanaryRaw || '').trim()),
    EXPORT_ALLOWLIST_IDS_RAW: getFirst(['OPSMANTIK_EXPORT_ALLOWLIST_IDS'], ''),
    CANARY_EXPECTED_QUEUE_ID: getFirst(['OPSMANTIK_CANARY_EXPECTED_QUEUE_ID'], ''),
    CANARY_APPROVAL_TOKEN: String(getFirst(['OPSMANTIK_CANARY_APPROVAL'], '')).trim(),
    CANARY_UPLOAD_APPROVAL_TOKEN: String(
      getFirst(['OPSMANTIK_CANARY_UPLOAD_APPROVAL', 'CANARY_UPLOAD_APPROVAL'], '')
    ).trim(),
    OPERATOR_ID: getFirst(['OPSMANTIK_OPERATOR_ID'], 'google-ads-script'),
    CHANGE_TICKET: getFirst(['OPSMANTIK_CHANGE_TICKET'], 'koc-oto-kurtarma-oci'),
    MAX_SYNC_PAGES: MAX_SYNC_PAGES,
    MAX_PEEK_PAGES: MAX_PEEK_PAGES,
    MAX_RUNTIME_MS: MAX_RUNTIME_MS,
    DRAIN_APPROVAL_TOKEN: String(getFirst(['OPSMANTIK_DRAIN_APPROVAL'], '')).trim(),
    DRAIN_SITE_ID: String(getFirst(['OPSMANTIK_DRAIN_SITE_ID'], '')).trim(),
    DRAIN_MAX_BATCH_NUM: DRAIN_MAX_BATCH_NUM,
    DRAIN_INCLUDE_BRAIDS: String(getFirst(['OPSMANTIK_DRAIN_INCLUDE_BRAIDS'], '')).trim(),
    HTTP: Object.freeze({
      MAX_RETRIES: 5,
      INITIAL_DELAY_MS: 1500,
    }),
  });
}

var CONFIG = getScriptConfig();

function parseAllowlistIds(raw) {
  const value = (raw || '').trim();
  if (!value) return null;
  const set = new Set(
    value
      .split(',')
      .map(function (x) {
        return (x || '').trim();
      })
      .filter(function (x) {
        return x.length > 0;
      })
  );
  return set.size > 0 ? set : null;
}

/**
 * PR-9H.7A: server-prehashed phone only (`hashedPhoneNumber` / `userIdentifiers` type `hashed_phone`).
 * Returns lowercase 64-char hex or '' — never derive from raw phone in script.
 */
function extractVerifiedHashedPhoneCourier(src) {
  if (!src || typeof src !== 'object') return '';
  const candidates = [];
  if (typeof src.hashedPhoneNumber === 'string' && src.hashedPhoneNumber.trim()) {
    candidates.push(src.hashedPhoneNumber.trim().toLowerCase());
  }
  if (typeof src.hashed_phone_number === 'string' && src.hashed_phone_number.trim()) {
    candidates.push(src.hashed_phone_number.trim().toLowerCase());
  }
  const list = src.userIdentifiers || src.user_identifiers;
  if (list && list.length) {
    for (let ui = 0; ui < list.length; ui++) {
      const ent = list[ui] || {};
      const tpe = String(ent.type || '')
        .trim()
        .toLowerCase();
      if (tpe === 'hashed_phone' && ent.value != null && String(ent.value).trim()) {
        candidates.push(String(ent.value).trim().toLowerCase());
      }
    }
  }
  for (let j = 0; j < candidates.length; j++) {
    if (/^[a-f0-9]{64}$/.test(candidates[j])) return candidates[j];
  }
  return '';
}

/** Effective hashed-phone Bulk Upload CSV column header when upload flag is on. */
function resolveHashedPhoneCsvColumnName() {
  const fromConst = typeof HASHED_PHONE_UPLOAD_COLUMN === 'string' ? HASHED_PHONE_UPLOAD_COLUMN.trim() : '';
  if (fromConst) return fromConst;
  return String((CONFIG && CONFIG.HASHED_PHONE_CSV_COLUMN) || '').trim();
}

/** PR-9H.7B: sync + hashed phone upload requires production canary bundle on export fetch (fail-closed). */
function validateHashedPhoneCsvCanaryForSync(cfg) {
  if (!cfg || !cfg.INCLUDE_HASHED_PHONE_IN_UPLOAD) return '';
  if (!cfg.HASHED_PHONE_CSV_CANARY_MODE) {
    throw new Error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE);
  }
  if (cfg.LIMIT !== 1) {
    throw new Error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE);
  }
  const parts = String(cfg.EXPORT_ALLOWLIST_IDS_RAW || '')
    .split(',')
    .map(function (s) {
      return s.trim();
    })
    .filter(function (x) {
      return x;
    });
  if (parts.length !== 1) {
    throw new Error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE);
  }
  const qid = parts[0];
  const expected = String(cfg.CANARY_EXPECTED_QUEUE_ID || '').trim();
  if (!expected || expected !== qid) {
    throw new Error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE);
  }
  if (String(cfg.CANARY_APPROVAL_TOKEN || '').trim() !== 'I_APPROVE_PRODUCTION_CANARY') {
    throw new Error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE);
  }
  if (String(cfg.CANARY_UPLOAD_APPROVAL_TOKEN || '').trim() !== 'I_APPROVE_SINGLE_PAYLOAD_GOOGLE_UPLOAD') {
    throw new Error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE);
  }
  return qid;
}

/** SSOT literals — must mirror Google Ads ► Conversions naming (exact string match required by Google Bulk Upload). */
var CONVERSION_EVENTS = Object.freeze({
  CONTACTED: 'OpsMantik_Contacted',
  OFFERED: 'OpsMantik_Offered',
  WON: 'OpsMantik_Won',
  JUNK_EXCLUSION: 'OpsMantik_Junk_Exclusion',
});

/** PR-9I — Bulk Upload CSV headers (explicit; keep aligned with Google Ads offline import template). */
var CSV_COL_ORDER_ID = 'Order ID';
var CSV_COL_GOOGLE_CLICK_ID = 'Google Click ID';
var CSV_COL_WBRAID = 'WBRAID';
var CSV_COL_GBRAID = 'GBRAID';
var CSV_COL_CONVERSION_NAME = 'Conversion name';
var CSV_COL_CONVERSION_TIME = 'Conversion time';
var CSV_COL_CONVERSION_VALUE = 'Conversion value';
var CSV_COL_CONVERSION_CURRENCY = 'Conversion currency';

/**
 * PR-9I — Priority gclid > wbraid > gbraid. Exactly one identifier column populated per row.
 * Never log literal identifier values.
 */
function resolveUploadIdentifier(row) {
  const gclid = row.gclid ? String(row.gclid).trim() : '';
  const wbraid = row.wbraid ? String(row.wbraid).trim() : '';
  const gbraid = row.gbraid ? String(row.gbraid).trim() : '';
  const hadGclid = gclid.length > 0;
  const hadWbraid = wbraid.length > 0;
  const hadGbraid = gbraid.length > 0;
  const nPresent = (hadGclid ? 1 : 0) + (hadWbraid ? 1 : 0) + (hadGbraid ? 1 : 0);
  const multipleClickIds = nPresent > 1;
  let selectedType = null;
  let selectedValue = '';
  if (hadGclid) {
    selectedType = 'gclid';
    selectedValue = gclid;
  } else if (hadWbraid) {
    selectedType = 'wbraid';
    selectedValue = wbraid;
  } else if (hadGbraid) {
    selectedType = 'gbraid';
    selectedValue = gbraid;
  }
  if (selectedType) {
    return {
      valid: true,
      reason: null,
      selectedType: selectedType,
      selectedValue: selectedValue,
      hadGclid: hadGclid,
      hadWbraid: hadWbraid,
      hadGbraid: hadGbraid,
      multipleClickIds: multipleClickIds,
    };
  }
  const hp = extractVerifiedHashedPhoneCourier(row);
  if (hp) {
    return {
      valid: false,
      reason: 'HASHED_PHONE_ONLY_SCRIPT_LANE_UNSUPPORTED',
      selectedType: null,
      selectedValue: '',
      hadGclid: false,
      hadWbraid: false,
      hadGbraid: false,
      multipleClickIds: false,
    };
  }
  return {
    valid: false,
    reason: 'MISSING_CLICK_ID',
    selectedType: null,
    selectedValue: '',
    hadGclid: false,
    hadWbraid: false,
    hadGbraid: false,
    multipleClickIds: false,
  };
}

function opsClockMs() {
  return new Date().getTime();
}

/** Pre-flight reminder (non-secret); pair with tighter triggers when backlog exceeds per-run fuse. */
function logOperationalGoogleLimitChecklist() {
  Telemetry.info('OPERATIONAL_GOOGLE_LIMITS_REMINDER', {
    conversion_action_names_must_match_ads_ui: [
      CONVERSION_EVENTS.CONTACTED,
      CONVERSION_EVENTS.OFFERED,
      CONVERSION_EVENTS.WON,
      CONVERSION_EVENTS.JUNK_EXCLUSION,
    ],
    bulk_upload_universal_click_ids: 'gclid>wbraid>gbraid exactly one column per row (PR-9I)',
    max_runtime_budget_ms_configured: CONFIG && CONFIG.MAX_RUNTIME_MS,
    max_sync_pages_cap: CONFIG && CONFIG.MAX_SYNC_PAGES,
    max_peek_pages_cap: CONFIG && CONFIG.MAX_PEEK_PAGES,
  });
}

function warnHashedPhoneCsvColumnIfSuspect() {
  if (!CONFIG || !CONFIG.INCLUDE_HASHED_PHONE_IN_UPLOAD) return;
  var col = resolveHashedPhoneCsvColumnName();
  if (!col.length) return;
  if (col.length < 8) {
    Telemetry.warn('HASHED_PHONE_HEADER_VERIFICATION_USE_EXACT_GOOGLE_TEMPLATE', {
      chars: col.length,
    });
  }
}

var Telemetry = {
  info: function (msg, meta) {
    Logger.log('[INFO] ' + msg + (meta ? ' | ' + JSON.stringify(meta) : ''));
  },
  warn: function (msg, meta) {
    Logger.log('[WARN] ' + msg + (meta ? ' | ' + JSON.stringify(meta) : ''));
  },
  error: function (msg, err) {
    Logger.log('[ERROR] ' + msg + ' | ' + (err && err.message ? err.message : String(err || '')));
    if (err && err.stack) Logger.log('   Stack: ' + err.stack);
  },
};

var Validator = {
  isValidGoogleAdsTime: function (timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return false;
    const s = timeStr.trim();
    if (/^\d{8} \d{6}$/.test(s)) return true;
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:?\d{2}$/.test(s);
  },

  normalizeGoogleAdsTime: function (timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return '';
    const s = timeStr.trim();
    if (/^\d{8} \d{6}$/.test(s)) return s;
    return s.replace(/([+-]\d{2}):(\d{2})$/, '$1$2');
  },

  /**
   * PR-9I: Universal click-id lane — gclid > wbraid > gbraid; hashed-phone-only rejected for Script bulk upload.
   */
  analyze: function (row) {
    const idRes = resolveUploadIdentifier(row);
    if (!idRes.valid) {
      return { valid: false, reason: idRes.reason || 'MISSING_CLICK_ID' };
    }
    if (!row.conversionTime) return { valid: false, reason: 'MISSING_TIME' };
    if (!this.isValidGoogleAdsTime(row.conversionTime)) return { valid: false, reason: 'INVALID_TIME_FORMAT' };
    return {
      valid: true,
      clickId: idRes.selectedValue,
      selectedType: idRes.selectedType,
      selectedValue: idRes.selectedValue,
      multipleClickIds: idRes.multipleClickIds,
      hadGclid: idRes.hadGclid,
      hadWbraid: idRes.hadWbraid,
      hadGbraid: idRes.hadGbraid,
    };
  },
};

function KocOtoClient(baseUrl, apiKey) {
  this.baseUrl = baseUrl.replace(/\/+$/, '');
  this.apiKey = apiKey;
  this.sessionToken = null;
  this.siteId = null;
}

KocOtoClient.prototype._fetchWithBackoff = function (url, options) {
  let attempt = 0;
  let delay = CONFIG.HTTP.INITIAL_DELAY_MS;

  while (attempt < CONFIG.HTTP.MAX_RETRIES) {
    try {
      const response = UrlFetchApp.fetch(url, Object.assign({}, options, { muteHttpExceptions: true }));
      const code = response.getResponseCode();

      if (code >= 200 && code < 300) return response;

      const body = response.getContentText() || '';
      if (code === 429 || code >= 500) {
        Telemetry.warn('Retryable HTTP', { code: code, attempt: attempt + 1, body: body.slice(0, 200) });
      } else {
        throw new Error('Critical HTTP Error ' + code + ': ' + body);
      }
    } catch (err) {
      if (attempt === CONFIG.HTTP.MAX_RETRIES - 1) throw err;
      Telemetry.warn('Network retry', { attempt: attempt + 1, error: String(err && err.message ? err.message : err) });
    }

    attempt++;
    Utilities.sleep(delay + Math.floor(Math.random() * 500));
    delay *= 2;
  }

  throw new Error('Max retries exceeded: ' + url);
};

KocOtoClient.prototype._isUnauthorized = function (err) {
  const msg = err && err.message ? String(err.message) : String(err || '');
  return msg.indexOf('Critical HTTP Error 401') >= 0 || msg.indexOf('Critical HTTP Hatasi 401') >= 0;
};

KocOtoClient.prototype._isQueueClaimMismatch = function (err) {
  const msg = err && err.message ? String(err.message) : String(err || '');
  return msg.indexOf('QUEUE_CLAIM_MISMATCH') >= 0 || (msg.indexOf('HTTP Error 409') >= 0 && msg.indexOf('claim') >= 0);
};

KocOtoClient.prototype.verifyHandshake = function (siteId) {
  this.siteId = siteId;
  const url = this.baseUrl + '/api/oci/v2/verify';
  const response = this._fetchWithBackoff(url, {
    method: 'post',
    headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
    payload: JSON.stringify({ siteId: siteId }),
  });
  const data = JSON.parse(response.getContentText() || '{}');
  if (!data.session_token) throw new Error('Handshake failed: session_token missing');
  this.sessionToken = data.session_token;
};

KocOtoClient.prototype._computeHexSignature = function (payload, secret) {
  if (!payload || !secret) return '';
  try {
    var signature = Utilities.computeHmacSha256Signature(payload, secret);
    var hex = '';
    for (var i = 0; i < signature.length; i++) {
      var val = signature[i];
      if (val < 0) val += 256;
      var str = val.toString(16);
      if (str.length === 1) str = '0' + str;
      hex += str;
    }
    return hex;
  } catch (e) {
    Telemetry.warn('Signature calculation failed', e);
    return '';
  }
};

KocOtoClient.prototype._fetchWithSessionRetry = function (url, options) {
  try {
    return this._fetchWithBackoff(url, options);
  } catch (err) {
    if (!this.sessionToken || !this.siteId || !this._isUnauthorized(err)) throw err;
    Telemetry.warn('Session expired; renewing handshake', { url: url });
    this.verifyHandshake(this.siteId);
    const nextHeaders = Object.assign({}, options && options.headers ? options.headers : {});
    if (nextHeaders.Authorization) {
      nextHeaders.Authorization = 'Bearer ' + this.sessionToken;
    }
    // Re-sign if payload exists and we have an API key
    if (nextHeaders['x-oci-signature'] && options.payload && this.apiKey) {
      nextHeaders['x-oci-signature'] = this._computeHexSignature(options.payload, this.apiKey);
    }
    return this._fetchWithBackoff(url, Object.assign({}, options, { headers: nextHeaders }));
  }
};

/**
 * GET export items.
 * @param {boolean|undefined} markAsExported default true (claim lane)
 * @param {number|undefined} limitOverride per-request limit (canary rows budget)
 */
KocOtoClient.prototype.fetchPage = function (siteId, cursor, markAsExported, limitOverride) {
  var doMark = markAsExported !== false;
  var lim =
    limitOverride != null && Number(limitOverride) > 0
      ? Math.min(1000, Math.floor(Number(limitOverride)))
      : CONFIG.LIMIT;
  let url =
    this.baseUrl +
    '/api/oci/google-ads-export?siteId=' +
    encodeURIComponent(siteId) +
    '&markAsExported=' +
    (doMark ? 'true' : 'false') +
    '&providerKey=google_ads' +
    '&limit=' +
    encodeURIComponent(String(lim));
  if (cursor) url += '&cursor=' + encodeURIComponent(cursor);

  var exportAllowlistParts = String((CONFIG && CONFIG.EXPORT_ALLOWLIST_IDS_RAW) || '')
    .split(',')
    .map(function (s) {
      return s.trim();
    })
    .filter(function (x) {
      return x;
    });

  var serverPreviewAllowlistId = exportAllowlistParts.length === 1 ? exportAllowlistParts[0] : '';

  var hpCanaryFetch =
    RESOLVED_HP_CANARY_QUEUE_ID &&
    doMark &&
    CONFIG &&
    CONFIG.INCLUDE_HASHED_PHONE_IN_UPLOAD &&
    CONFIG.HASHED_PHONE_CSV_CANARY_MODE;

  var effectiveServerAllowlistId = hpCanaryFetch
    ? String(RESOLVED_HP_CANARY_QUEUE_ID)
    : !doMark
      ? String(serverPreviewAllowlistId)
      : '';

  if (effectiveServerAllowlistId) {
    url += '&canaryMode=true';
    url += '&allowlistIds=' + encodeURIComponent(effectiveServerAllowlistId);
    url += '&allowlist_ids=' + encodeURIComponent(effectiveServerAllowlistId);
  }

  var getHeaders = {
    Authorization: 'Bearer ' + this.sessionToken,
    Accept: 'application/json',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
  };
  if (
    effectiveServerAllowlistId &&
    CONFIG.CANARY_APPROVAL_TOKEN === 'I_APPROVE_PRODUCTION_CANARY' &&
    (!doMark ||
      String(CONFIG.CANARY_UPLOAD_APPROVAL_TOKEN || '').trim() === 'I_APPROVE_SINGLE_PAYLOAD_GOOGLE_UPLOAD')
  ) {
    getHeaders['x-opsmantik-canary-mode'] = 'true';
    getHeaders['x-opsmantik-canary-approval'] = CONFIG.CANARY_APPROVAL_TOKEN;
    getHeaders['x-opsmantik-canary-site-id'] = String(siteId);
    getHeaders['x-opsmantik-canary-max-batch-size'] = '1';
    getHeaders['x-opsmantik-canary-expected-queue-id'] = String(effectiveServerAllowlistId);
    getHeaders['x-opsmantik-change-ticket'] = String(CONFIG.CHANGE_TICKET || 'hashed-phone-csv-canary');
    getHeaders['x-opsmantik-operator-id'] = String(CONFIG.OPERATOR_ID || 'google-ads-script');
    getHeaders['x-opsmantik-allowlist-ids'] = String(effectiveServerAllowlistId);
  }

  /** PR-9I — broad mutating claim without server canary: backend requires drain metadata (headers or Vercel env). */
  var broadDrainClaim = doMark && !hpCanaryFetch;
  if (broadDrainClaim && CONFIG) {
    var dAppr = String(CONFIG.DRAIN_APPROVAL_TOKEN || '').trim();
    var dSite = String(CONFIG.DRAIN_SITE_ID || '').trim();
    var dBraid = String(CONFIG.DRAIN_INCLUDE_BRAIDS || '').trim();
    var dBatchCfg = CONFIG.DRAIN_MAX_BATCH_NUM || 0;
    var dBatchEff = dBatchCfg >= lim ? dBatchCfg : lim;
    if (dAppr && dSite && dBraid) {
      getHeaders['x-opsmantik-drain-approval'] = dAppr;
      getHeaders['x-opsmantik-drain-site-id'] = dSite;
      getHeaders['x-opsmantik-drain-max-batch-size'] = String(dBatchEff);
      getHeaders['x-opsmantik-drain-include-braids'] = dBraid;
    }
  }

  let response;
  try {
    response = this._fetchWithSessionRetry(url, {
      method: 'get',
      headers: getHeaders,
    });
  } catch (err) {
    if (this._isQueueClaimMismatch(err)) {
      Telemetry.warn('Queue claim mismatch, ending this run gracefully', { siteId: siteId });
      return {
        items: [],
        nextCursor: null,
        hasNextPage: false,
        counts: null,
        resolvedSiteUuid: siteId,
        markAsExported: doMark,
        warnings: ['QUEUE_CLAIM_MISMATCH'],
      };
    }
    throw err;
  }

  const payload = JSON.parse(response.getContentText() || '{}');
  let items = [];
  if (Array.isArray(payload)) {
    items = payload;
  } else if (Array.isArray(payload.data)) {
    items = payload.data;
  } else if (Array.isArray(payload.items)) {
    items = payload.items;
  }

  const nextCursor =
    payload && payload.meta && payload.meta.nextCursor
      ? payload.meta.nextCursor
      : payload.next_cursor || null;
  const hasNextPage =
    payload && payload.meta && typeof payload.meta === 'object'
      ? payload.meta.hasNextPage === true
      : !!nextCursor;

  return {
    items: items,
    nextCursor: nextCursor,
    hasNextPage: hasNextPage,
    counts: payload.counts || null,
    resolvedSiteUuid: payload.siteId || null,
    markAsExported: typeof payload.markAsExported === 'boolean' ? payload.markAsExported : doMark,
    warnings: payload.warnings || null,
    exportRunId: payload.export_run_id || null,
    previewDiagnostics: payload.preview_diagnostics && typeof payload.preview_diagnostics === 'object'
      ? payload.preview_diagnostics
      : null,
  };
};

KocOtoClient.prototype.sendAck = function (siteId, queueIds, skippedIds, failedRows) {
  const q = queueIds || [];
  const s = skippedIds || [];
  const f = failedRows || [];
  if (!q.length && !s.length && !f.length) return null;

  const url = this.baseUrl + '/api/oci/ack';
  const payload = { siteId: siteId, queueIds: q };
  if (s.length > 0) payload.skippedIds = s;
  if (f.length > 0) {
    payload.results = []
      .concat(q.map(function (id) {
        return { id: id, status: 'SUCCESS' };
      }))
      .concat(
        f.map(function (row) {
          return {
            id: row.queueId,
            status: 'FAILED',
            reason: row.errorCode || 'SCRIPT_ROW_FAILED',
          };
        })
      );
  }

  const payloadStr = JSON.stringify(payload);
  const response = this._fetchWithSessionRetry(url, {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + this.sessionToken,
      'Content-Type': 'application/json',
      'x-oci-signature': this._computeHexSignature(payloadStr, this.apiKey),
    },
    payload: payloadStr,
  });
  try {
    return JSON.parse(response.getContentText() || '{}');
  } catch (e) {
    return { ok: false };
  }
};

KocOtoClient.prototype.sendAckFailed = function (siteId, queueIds, errorCode, errorMessage, errorCategory) {
  if (!queueIds || !queueIds.length) return null;
  const url = this.baseUrl + '/api/oci/ack-failed';
  const payload = JSON.stringify({
    siteId: siteId,
    queueIds: queueIds,
    errorCode: errorCode || 'UNKNOWN',
    errorMessage: errorMessage || errorCode,
    errorCategory: errorCategory || 'TRANSIENT',
  });
  const response = this._fetchWithSessionRetry(url, {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + this.sessionToken,
      'Content-Type': 'application/json',
      'x-oci-signature': this._computeHexSignature(payload, this.apiKey),
    },
    payload: payload,
  });
  try {
    return JSON.parse(response.getContentText() || '{}');
  } catch (e) {
    return { ok: true };
  }
};

KocOtoClient.prototype.sendSummary = function (summaryPayload) {
  try {
    const url = this.baseUrl + '/api/oci/export-run-summary';
    const payloadStr = JSON.stringify(summaryPayload);
    const headers = {
      Authorization: 'Bearer ' + this.sessionToken,
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['x-oci-signature'] = this._computeHexSignature(payloadStr, this.apiKey);
    }
    const response = this._fetchWithSessionRetry(url, {
      method: 'post',
      headers: headers,
      payload: payloadStr,
    });
    return JSON.parse(response.getContentText() || '{}');
  } catch (err) {
    Telemetry.warn('sendSummary failed (optional)', err);
    return { ok: false };
  }
};

function processPageUpload(rows, opts) {
  const o = opts || {};
  const includeHp = CONFIG && CONFIG.INCLUDE_HASHED_PHONE_IN_UPLOAD === true;
  const hpColName = resolveHashedPhoneCsvColumnName();
  const csvCanaryStrict = Boolean(RESOLVED_HP_CANARY_QUEUE_ID);
  if (csvCanaryStrict) {
    if (rows.length !== 1) {
      Telemetry.error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE, { row_count: rows.length });
      throw new Error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE);
    }
    const r0 = rows[0];
    const actualRaw = r0 && r0.id != null ? String(r0.id).trim() : '';
    const actualCanon = stripKnownExportQueuePrefix(actualRaw);
    const expected = String(RESOLVED_HP_CANARY_QUEUE_ID || '').trim();
    if (!r0 || (actualCanon !== expected && actualRaw !== expected)) {
      Telemetry.error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE, {
        reason: 'EXPECTED_QUEUE_ID_MISMATCH',
        expected_tail: expected.length > 10 ? expected.slice(-8) : expected,
        actual_tail: actualRaw ? actualRaw.slice(-12) : '',
      });
      throw new Error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE);
    }
  }

  const timezone = AdsApp.currentAccount().getTimeZone() || 'Europe/Istanbul';
  const baseHeaders = [
    CSV_COL_ORDER_ID,
    CSV_COL_GOOGLE_CLICK_ID,
    CSV_COL_WBRAID,
    CSV_COL_GBRAID,
    CSV_COL_CONVERSION_NAME,
    CSV_COL_CONVERSION_TIME,
    CSV_COL_CONVERSION_VALUE,
    CSV_COL_CONVERSION_CURRENCY,
  ];
  const headers = baseHeaders.slice();
  if (includeHp) headers.push(hpColName);

  const upload = AdsApp.bulkUploads().newCsvUpload(headers, { moneyInMicros: false, timeZone: timezone });
  upload.forOfflineConversions();
  upload.setFileName('OpsMantik_KocOtoKurtarma_' + new Date().toISOString() + '.csv');

  const stats = {
    uploaded: 0,
    successIds: [],
    skippedIds: [],
    failedRows: [],
    uploadFailed: false,
    classified_uploadable_count: 0,
    classified_skipped_count: 0,
    classified_failed_count: 0,
    ack_failed_sent_count: 0,
    ack_failed_dispatch_failed_count: 0,
    selected_gclid_count: 0,
    selected_wbraid_count: 0,
    selected_gbraid_count: 0,
    multiple_click_ids_count: 0,
    hashed_phone_attached_count: 0,
    hashed_phone_only_rejected_count: 0,
    missing_click_id_count: 0,
    invalid_time_count: 0,
    other_validation_failed_count: 0,
  };

  function bumpFail(reason, queueRow) {
    stats.classified_failed_count++;
    if (reason === 'HASHED_PHONE_ONLY_SCRIPT_LANE_UNSUPPORTED') stats.hashed_phone_only_rejected_count += 1;
    else if (reason === 'MISSING_CLICK_ID') stats.missing_click_id_count += 1;
    else if (reason === 'MISSING_TIME' || reason === 'INVALID_TIME_FORMAT') stats.invalid_time_count += 1;
    else stats.other_validation_failed_count += 1;
    if (queueRow && queueRow.id) {
      stats.failedRows.push({
        queueId: queueRow.id,
        errorCode: reason,
        errorMessage: reason,
        errorCategory: 'VALIDATION',
      });
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const v = Validator.analyze(row);
    if (!v.valid) {
      bumpFail(v.reason, row);
      continue;
    }

    if (csvCanaryStrict && includeHp && !extractVerifiedHashedPhoneCourier(row)) {
      stats.classified_failed_count++;
      stats.other_validation_failed_count++;
      if (row && row.id) {
        stats.failedRows.push({
          queueId: row.id,
          errorCode: HASHED_PHONE_EXPORT_MISSING,
          errorMessage: HASHED_PHONE_EXPORT_MISSING,
          errorCategory: 'VALIDATION',
        });
      }
      continue;
    }

    const orderIdRaw = row.orderId || row.id || '';
    const orderId = String(orderIdRaw).slice(0, 64);
    if (!orderId) {
      stats.classified_failed_count++;
      stats.other_validation_failed_count++;
      if (row && row.id) {
        stats.failedRows.push({
          queueId: row.id,
          errorCode: 'MISSING_ORDER_ID',
          errorMessage: 'MISSING_ORDER_ID',
          errorCategory: 'VALIDATION',
        });
      }
      continue;
    }

    stats.classified_uploadable_count++;

    const conversionValue = Math.max(0, parseFloat(String(row.conversionValue || 0).replace(/[^\d.-]/g, '')) || 0);
    const conversionName = (row.conversionName || '').trim() || CONVERSION_EVENTS.WON;
    const currency = (row.conversionCurrency || 'TRY').toUpperCase();

    if (v.selectedType === 'gclid') stats.selected_gclid_count++;
    else if (v.selectedType === 'wbraid') stats.selected_wbraid_count++;
    else if (v.selectedType === 'gbraid') stats.selected_gbraid_count++;
    if (v.multipleClickIds) stats.multiple_click_ids_count++;

    const rowAppend = {};
    rowAppend[CSV_COL_ORDER_ID] = orderId;
    rowAppend[CSV_COL_GOOGLE_CLICK_ID] = v.selectedType === 'gclid' ? v.selectedValue : '';
    rowAppend[CSV_COL_WBRAID] = v.selectedType === 'wbraid' ? v.selectedValue : '';
    rowAppend[CSV_COL_GBRAID] = v.selectedType === 'gbraid' ? v.selectedValue : '';
    rowAppend[CSV_COL_CONVERSION_NAME] = conversionName;
    rowAppend[CSV_COL_CONVERSION_TIME] = Validator.normalizeGoogleAdsTime(row.conversionTime);
    rowAppend[CSV_COL_CONVERSION_VALUE] = conversionValue;
    rowAppend[CSV_COL_CONVERSION_CURRENCY] = currency;

    if (includeHp) {
      const hpVal = String(extractVerifiedHashedPhoneCourier(row) || '').trim();
      const hpNorm = /^[a-f0-9]{64}$/i.test(hpVal) ? hpVal.toLowerCase() : '';
      rowAppend[hpColName] = hpNorm;
      if (hpNorm) stats.hashed_phone_attached_count++;
    }
    upload.append(rowAppend);

    stats.uploaded++;
    if (row.id) stats.successIds.push(row.id);
  }

  if (stats.uploaded > 0) {
    try {
      upload.apply();
    } catch (err) {
      stats.uploadFailed = true;
      const msg = err && err.message ? String(err.message).slice(0, 500) : 'UPLOAD_EXCEPTION';
      if (includeHp && /column|header|unknown field|invalid field/i.test(msg)) {
        Telemetry.warn('UPLOAD_FAIL_POSSIBLE_CSV_SCHEMA_MISMATCH_HINT_CHECK_HASHED_PHONE_HEADER_AND_CONVERSION_NAMES', {
          excerpt: msg.slice(0, 240),
        });
      }
      if (typeof o.onUploadFailure === 'function' && stats.successIds.length > 0) {
        try {
          const ackFailedRes = o.onUploadFailure(stats.successIds, 'UPLOAD_EXCEPTION', msg, 'TRANSIENT');
          if (ackFailedRes && ackFailedRes.ok === false) {
            stats.ack_failed_dispatch_failed_count += stats.successIds.length;
          } else {
            stats.ack_failed_sent_count += stats.successIds.length;
          }
        } catch (ackErr) {
          stats.ack_failed_dispatch_failed_count += stats.successIds.length;
          Telemetry.error('ACK_FAILED_AFTER_UPLOAD_EXCEPTION_FAILED', ackErr);
        }
      }
    }
  }

  return stats;
}

function resolveRunMode() {
  let propMode = '';
  try {
    if (typeof PropertiesService !== 'undefined') {
      propMode = PropertiesService.getScriptProperties().getProperty('OPSMANTIK_RUN_MODE') || '';
    }
  } catch (e) {
    /* ignore */
  }
  const inlineMode = getInlineForKeys(['OPSMANTIK_RUN_MODE', 'OPSMANTIK_RUNMODE']);
  let envMode = '';
  try {
    if (typeof process !== 'undefined' && process.env && process.env.OPSMANTIK_RUN_MODE) {
      envMode = String(process.env.OPSMANTIK_RUN_MODE).trim();
    }
  } catch (e2) {
    /* ignore */
  }
  const raw = String(
    propMode.trim() ||
      inlineMode ||
      envMode ||
      (typeof OPSMANTIK_RUN_MODE === 'string' ? OPSMANTIK_RUN_MODE.trim() : '') ||
      'sync'
  ).toLowerCase();
  if (
    raw === 'peek' ||
    raw === 'preview' ||
    raw === 'dry' ||
    raw === 'kuyruk' ||
    raw === 'queue'
  ) {
    return 'peek';
  }
  return 'sync';
}

/** Show OCI queue without uploading (markAsExported=false). */
function mainPeekOciQueue() {
  RESOLVED_HP_CANARY_QUEUE_ID = '';
  Telemetry.info('Koc Oto Kurtarma - PEEK / OCI queue summary');
  Telemetry.info(
    'NOTE: Intent cards are not shown here; this log summarizes journal rows from offline_conversion_queue only.'
  );

  CONFIG = getScriptConfig();

  if (!CONFIG.SITE_ID || !CONFIG.API_KEY) {
    Telemetry.error(
      'Eksik yapılandırma: INLINE OPSMANTIK_INLINE_SITE_ID ve OPSMANTIK_INLINE_API_KEY veya Script Properties.',
      null
    );
    return;
  }

  logOperationalGoogleLimitChecklist();

  /** Peek is no-claim: optional filter from OPSMANTIK_ALLOWLIST_IDS or server canary bundle UUID list. */
  const allowlist = parseAllowlistIds(CONFIG.ALLOWLIST_IDS || CONFIG.EXPORT_ALLOWLIST_IDS_RAW);

  try {
    const client = new KocOtoClient(CONFIG.BASE_URL, CONFIG.API_KEY);
    client.verifyHandshake(CONFIG.SITE_ID);

    let cursor = null;
    let pageNo = 0;
    let grandTotalRows = 0;
    var peekStartedAt = opsClockMs();
    var peekStoppedReason = '';
    var lastHadNextPage = false;
    var lastNextCursor = null;

    while (pageNo < CONFIG.MAX_PEEK_PAGES) {
      if (opsClockMs() - peekStartedAt >= CONFIG.MAX_RUNTIME_MS) {
        peekStoppedReason = 'MAX_RUNTIME_MS';
        Telemetry.warn('PEEK_STOP_RUNTIME_BUDGET', {
          max_runtime_ms: CONFIG.MAX_RUNTIME_MS,
          pagesFetched: pageNo,
        });
        break;
      }
      pageNo++;
      const page = client.fetchPage(CONFIG.SITE_ID, cursor, false);

      Telemetry.info('PEEK export page', {
        sayfa: pageNo,
        cozumlendi_site_uuid: page.resolvedSiteUuid,
        counts: page.counts,
        markAsExportedSunucu: page.markAsExported,
        uyarilar: page.warnings,
        satirBuSayfa: (page.items || []).length,
      });

      if (page.previewDiagnostics) {
        var pd = page.previewDiagnostics;
        Telemetry.info('PEEK_kuyruk_ozet', {
          sayfa: pageNo,
          fetched_count: pd.fetched_count,
          buildable_count: pd.buildable_count,
          returned_count: pd.returned_count,
          returned_action_counts: pd.returned_action_counts,
          skipped_count: pd.skipped_count,
        });
        /** Ayrı satır: Logger bazen uzun JSON keser; elenme nedenleri burada. */
        var srs = pd.skip_reason_counts;
        if (srs && typeof srs === 'object') {
          Logger.log('[INFO] PEEK_skip_nedenleri | sayfa=' + pageNo + ' | ' + JSON.stringify(srs));
        } else {
          Logger.log(
            '[WARN] PEEK_skip_nedenleri_yok | sayfa=' +
              pageNo +
              ' | preview_keys=' +
              JSON.stringify(Object.keys(pd || {}))
          );
        }
      }

      let rows = page.items || [];
      grandTotalRows += rows.length;

      if (allowlist && rows.length > 0) {
        rows = rows.filter(function (r) {
          return r && r.id && queueIdMatchesAllowlist(r.id, allowlist);
        });
        Telemetry.warn('Peek allowlist filtresi', { kalanSatir: rows.length });
      }

      var cap = Math.min(rows.length, 60);
      for (var ri = 0; ri < cap; ri++) {
        var rr = rows[ri];
        Logger.log(
          '[OCI_SIRA] id_snip=' +
            peekRedactQueueIdSnippet(rr && rr.id != null ? rr.id : '') +
            ' | aksiyon=' +
            (rr && rr.conversionName ? String(rr.conversionName) : '') +
            ' | deger=' +
            (rr && rr.conversionValue != null ? String(rr.conversionValue) : '') +
            ' | para=' +
            (rr && rr.conversionCurrency ? String(rr.conversionCurrency) : 'TRY') +
            ' | zaman=' +
            (rr && rr.conversionTime ? String(rr.conversionTime) : '') +
            ' | g=' +
            (rr && rr.gclid ? '1' : '0') +
            ' w=' +
            (rr && rr.wbraid ? '1' : '0') +
            ' gb=' +
            (rr && rr.gbraid ? '1' : '0') +
            ' hp=' +
            (rr && extractVerifiedHashedPhoneCourier(rr) ? '1' : '0')
        );
      }

      if (cap < rows.length) {
        Telemetry.info('Peek row summary truncated', {
          yazilanBuSayfa: cap,
          toplamBuSayfa: rows.length,
        });
      }

      cursor = page.nextCursor;
      lastHadNextPage = page.hasNextPage === true;
      lastNextCursor = cursor ? true : false;
      if (!(page.hasNextPage && cursor)) break;
      if (pageNo >= CONFIG.MAX_PEEK_PAGES) {
        peekStoppedReason = peekStoppedReason || 'MAX_PEEK_PAGES_CAP';
        Telemetry.warn('PEEK_STOPPED_MAX_PEEK_PAGES', {
          cap: CONFIG.MAX_PEEK_PAGES,
          more_claimed_via_cursor: !!(page.hasNextPage && cursor),
        });
        break;
      }
    }

    Telemetry.info('Koc Oto Kurtarma PEEK completed', {
      pageCount: pageNo,
      totalRows: grandTotalRows,
      stopped_reason: peekStoppedReason || null,
      truncate_hint:
        peekStoppedReason && lastHadNextPage && lastNextCursor
          ? 'More pages exist beyond fuse — widen trigger frequency or raise OPSMANTIK_MAX_PEEK_PAGES / budget.'
          : null,
    });
  } catch (err) {
    Telemetry.error('Koc Oto Kurtarma PEEK error', err);
    throw err;
  }
}

function mainSyncKocOto() {
  Telemetry.info('Koc Oto Kurtarma OCI SYNC - upload + ACK');

  RESOLVED_HP_CANARY_QUEUE_ID = '';
  CONFIG = getScriptConfig();

  if (!CONFIG.SITE_ID || !CONFIG.API_KEY) {
    Telemetry.error('Eksik yapılandırma: OPSMANTIK_SITE_ID ve OPSMANTIK_API_KEY (INLINE veya Script Properties).', null);
    return;
  }

  logOperationalGoogleLimitChecklist();

  if (CONFIG.INCLUDE_HASHED_PHONE_IN_UPLOAD) {
    const effHpCol = resolveHashedPhoneCsvColumnName();
    if (!effHpCol) {
      Telemetry.error('HASHED_PHONE_COLUMN_NOT_CONFIGURED: OPSMANTIK_HASHED_PHONE_CSV_COLUMN veya HASHED_PHONE_UPLOAD_COLUMN gerekli.', null);
      return;
    }
    if (CONFIG.HASHED_PHONE_CSV_CANARY_MODE) {
      try {
        RESOLVED_HP_CANARY_QUEUE_ID = validateHashedPhoneCsvCanaryForSync(CONFIG);
      } catch (eCanary) {
        Telemetry.error(
          'Hashed-phone sync canary dogrulanamadi (PR-9H.7B). Ayarlari kontrol edin.',
          eCanary || null
        );
        throw eCanary;
      }
    } else {
      RESOLVED_HP_CANARY_QUEUE_ID = '';
    }
    warnHashedPhoneCsvColumnIfSuspect();
  }

  const allowlist = parseAllowlistIds(CONFIG.ALLOWLIST_IDS);
  if (allowlist) {
    throw new Error(
      'CLIENT_ALLOWLIST_FORBIDDEN_IN_SYNC: Remove OPSMANTIK_ALLOWLIST_IDS. Client-side filtering after claim is unsafe. Use OPSMANTIK_EXPORT_ALLOWLIST_IDS only inside PR-9H.7B server canary.'
    );
  }

  try {
    const client = new KocOtoClient(CONFIG.BASE_URL, CONFIG.API_KEY);
    client.verifyHandshake(CONFIG.SITE_ID);

    let cursor = null;
    let totalUploaded = 0;
    let totalAck = 0;
    let pageNo = 0;
    
    let exportRunId = null;
    let summaryStats = {
      fetched_count: 0,
      claimed_count: 0,
      classified_uploadable_count: 0,
      classified_skipped_count: 0,
      classified_failed_count: 0,
      upload_attempted_count: 0,
      upload_success_count: 0,
      upload_failed_count: 0,
      ack_success_count: 0,
      ack_failed_count: 0,
      ack_skipped_count: 0,
      hashed_phone_csv_canary_active: Boolean(RESOLVED_HP_CANARY_QUEUE_ID && CONFIG.INCLUDE_HASHED_PHONE_IN_UPLOAD),
      stopped_reason: null,
      provider_ambiguous_pending_count: 0,
      selected_gclid_count: 0,
      selected_wbraid_count: 0,
      selected_gbraid_count: 0,
      multiple_click_ids_count: 0,
      hashed_phone_attached_count: 0,
      hashed_phone_only_rejected_count: 0,
      missing_click_id_count: 0,
      invalid_time_count: 0,
      other_validation_failed_count: 0,
    };

    /** PR-9H.7B: hashed-phone CSV canary — tek export sayfası; aksi halde MAX_SYNC_PAGES sigortası. */
    const maxPagesThisSync =
      RESOLVED_HP_CANARY_QUEUE_ID && CONFIG.INCLUDE_HASHED_PHONE_IN_UPLOAD ? 1 : CONFIG.MAX_SYNC_PAGES;

    var syncStartedAt = opsClockMs();

    while (pageNo < maxPagesThisSync) {
      if (opsClockMs() - syncStartedAt >= CONFIG.MAX_RUNTIME_MS) {
        summaryStats.stopped_reason = 'MAX_RUNTIME_MS';
        Telemetry.warn('SYNC_STOP_RUNTIME_BUDGET', {
          max_runtime_ms: CONFIG.MAX_RUNTIME_MS,
          pages_completed: pageNo,
          note: 'Next trigger will continue from cursor; adjust frequency or budgets if this fires often.',
        });
        break;
      }
      pageNo++;
      const page = client.fetchPage(CONFIG.SITE_ID, cursor, true, CONFIG.LIMIT);
      let rows = page.items || [];
      
      if (page.exportRunId && !exportRunId) {
        exportRunId = page.exportRunId;
      }

      if (RESOLVED_HP_CANARY_QUEUE_ID && CONFIG.INCLUDE_HASHED_PHONE_IN_UPLOAD) {
        if (rows.length !== 1) {
          Telemetry.error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE, {
            reason: 'CANARY_FETCH_EXPECTED_EXACTLY_ONE_ROW',
            row_count: rows.length,
          });
          throw new Error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE);
        }
      }

      summaryStats.fetched_count += rows.length;
      summaryStats.claimed_count += rows.length;

      if (rows.length > 0) {
        try {
          const stats = processPageUpload(rows, {
            onUploadFailure: function (ids, code, msg, cat) {
              return client.sendAckFailed(CONFIG.SITE_ID, ids, code, msg, cat);
            },
          });

          if (stats.uploadFailed) {
            summaryStats.classified_uploadable_count += stats.classified_uploadable_count;
            summaryStats.classified_skipped_count += stats.classified_skipped_count;
            summaryStats.classified_failed_count += stats.classified_failed_count;
            summaryStats.upload_attempted_count += stats.classified_uploadable_count;
            summaryStats.upload_failed_count += stats.classified_uploadable_count;
            summaryStats.ack_failed_count += stats.ack_failed_sent_count;
            summaryStats.selected_gclid_count += stats.selected_gclid_count || 0;
            summaryStats.selected_wbraid_count += stats.selected_wbraid_count || 0;
            summaryStats.selected_gbraid_count += stats.selected_gbraid_count || 0;
            summaryStats.multiple_click_ids_count += stats.multiple_click_ids_count || 0;
            summaryStats.hashed_phone_attached_count += stats.hashed_phone_attached_count || 0;
            summaryStats.hashed_phone_only_rejected_count += stats.hashed_phone_only_rejected_count || 0;
            summaryStats.missing_click_id_count += stats.missing_click_id_count || 0;
            summaryStats.invalid_time_count += stats.invalid_time_count || 0;
            summaryStats.other_validation_failed_count += stats.other_validation_failed_count || 0;
            if (stats.ack_failed_dispatch_failed_count > 0) {
              summaryStats.provider_ambiguous_pending_count += stats.ack_failed_dispatch_failed_count;
            }

            Telemetry.warn('upload.apply failed — ACK_FAILED dispatch tracked', {
              page: pageNo,
              ack_failed_sent_count: stats.ack_failed_sent_count,
              ack_failed_dispatch_failed_count: stats.ack_failed_dispatch_failed_count,
            });
            cursor = page.nextCursor;
            if (!(page.hasNextPage && cursor)) break;
            continue;
          }

          summaryStats.classified_uploadable_count += stats.classified_uploadable_count;
          summaryStats.classified_skipped_count += stats.classified_skipped_count;
          summaryStats.classified_failed_count += stats.classified_failed_count;
          summaryStats.upload_attempted_count += stats.classified_uploadable_count;
          summaryStats.upload_success_count += stats.uploaded;
          summaryStats.selected_gclid_count += stats.selected_gclid_count || 0;
          summaryStats.selected_wbraid_count += stats.selected_wbraid_count || 0;
          summaryStats.selected_gbraid_count += stats.selected_gbraid_count || 0;
          summaryStats.multiple_click_ids_count += stats.multiple_click_ids_count || 0;
          summaryStats.hashed_phone_attached_count += stats.hashed_phone_attached_count || 0;
          summaryStats.hashed_phone_only_rejected_count += stats.hashed_phone_only_rejected_count || 0;
          summaryStats.missing_click_id_count += stats.missing_click_id_count || 0;
          summaryStats.invalid_time_count += stats.invalid_time_count || 0;
          summaryStats.other_validation_failed_count += stats.other_validation_failed_count || 0;

          if (stats.successIds.length || stats.skippedIds.length || stats.failedRows.length) {
            const ackRes = client.sendAck(
              CONFIG.SITE_ID,
              stats.successIds,
              stats.skippedIds,
              stats.failedRows
            );
            if (ackRes && typeof ackRes.updated === 'number') totalAck += ackRes.updated;
            
            summaryStats.ack_success_count += stats.successIds.length;
            summaryStats.ack_skipped_count += stats.skippedIds.length;
            summaryStats.ack_failed_count += stats.failedRows.length;
          }

          totalUploaded += stats.uploaded;
          Telemetry.info('Sayfa sync', {
            page: pageNo,
            fetched: page.items.length,
            uploaded: stats.uploaded,
            failed: stats.failedRows.length,
            selected_gclid_count: stats.selected_gclid_count || 0,
            selected_wbraid_count: stats.selected_wbraid_count || 0,
            selected_gbraid_count: stats.selected_gbraid_count || 0,
            multiple_click_ids_count: stats.multiple_click_ids_count || 0,
            hashed_phone_attached_count: stats.hashed_phone_attached_count || 0,
            countsApi: page.counts,
          });
        } catch (err) {
          const errMsg = err && err.message ? String(err.message) : String(err || '');
          if (errMsg.indexOf(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE) >= 0) {
            Telemetry.error('CANARY_SCOPE_ABORTED_NO_ACK_FAILED_SENT', err);
            throw err;
          }
          Telemetry.error('Page processing error', err);
          const ids = (page.items || [])
            .map(function (r) {
              return r && r.id ? String(r.id) : '';
            })
            .filter(function (id) {
              return id.length > 0;
            });
          if (ids.length > 0) {
            client.sendAckFailed(
              CONFIG.SITE_ID,
              ids,
              'PAGE_PROCESSING_FAILURE',
              String(errMsg).slice(0, 500),
              'TRANSIENT'
            );
          }
          throw err;
        }
      }

      cursor = page.nextCursor;
      if (!(page.hasNextPage && cursor)) break;
      if (pageNo >= maxPagesThisSync && page.hasNextPage && cursor) {
        summaryStats.stopped_reason = summaryStats.stopped_reason || 'MAX_SYNC_PAGES_CAP';
        Telemetry.warn('SYNC_HIT_MAX_SYNC_PAGES_FUSE_MORE_QUEUE_REMAINS', {
          cap_pages: maxPagesThisSync,
        });
      }
    }

    Telemetry.info('Koc Oto Kurtarma SYNC completed', {
      totalUploaded: totalUploaded,
      pages: pageNo,
      stopped_reason: summaryStats.stopped_reason || null,
    });
    
    // Attempt to send run summary
    try {
      var summaryPayload = {
        export_run_id: exportRunId,
        summary_version: '1.0',
        generated_at: new Date().toISOString(),
        fetched_count: summaryStats.fetched_count,
        claimed_count: summaryStats.claimed_count,
        classified_uploadable_count: summaryStats.classified_uploadable_count,
        classified_skipped_count: summaryStats.classified_skipped_count,
        classified_failed_count: summaryStats.classified_failed_count,
        upload_attempted_count: summaryStats.upload_attempted_count,
        upload_success_count: summaryStats.upload_success_count,
        upload_failed_count: summaryStats.upload_failed_count,
        ack_success_count: summaryStats.ack_success_count,
        ack_failed_count: summaryStats.ack_failed_count,
        ack_skipped_count: summaryStats.ack_skipped_count,
        hashed_phone_csv_canary_active: summaryStats.hashed_phone_csv_canary_active,
        fuse_stopped_reason: summaryStats.stopped_reason,
        provider_ambiguous_pending_count: summaryStats.provider_ambiguous_pending_count,
        selected_gclid_count: summaryStats.selected_gclid_count,
        selected_wbraid_count: summaryStats.selected_wbraid_count,
        selected_gbraid_count: summaryStats.selected_gbraid_count,
        multiple_click_ids_count: summaryStats.multiple_click_ids_count,
        hashed_phone_attached_count: summaryStats.hashed_phone_attached_count,
        hashed_phone_only_rejected_count: summaryStats.hashed_phone_only_rejected_count,
        missing_click_id_count: summaryStats.missing_click_id_count,
        invalid_time_count: summaryStats.invalid_time_count,
        other_validation_failed_count: summaryStats.other_validation_failed_count,
      };
      Telemetry.info('Run summary counters', {
        export_run_id: exportRunId,
        upload_attempted_count: summaryStats.upload_attempted_count,
        selected_gclid_count: summaryStats.selected_gclid_count || 0,
        selected_wbraid_count: summaryStats.selected_wbraid_count || 0,
        selected_gbraid_count: summaryStats.selected_gbraid_count || 0,
        multiple_click_ids_count: summaryStats.multiple_click_ids_count || 0,
        hashed_phone_attached_count: summaryStats.hashed_phone_attached_count || 0,
      });
      var summaryRes = client.sendSummary(summaryPayload);
      Telemetry.info('Sent run summary', { 
        ok: summaryRes.ok, 
        status: summaryRes.script_summary_status,
        mismatch_reasons: summaryRes.mismatch_reasons
      });
    } catch (err) {
      Telemetry.warn('Failed to send run summary (optional feature)', err);
    }
    
  } catch (err) {
    if ((err && err.message ? String(err.message) : '').indexOf('QUEUE_CLAIM_MISMATCH') >= 0) {
      Telemetry.warn('SYNC ended due to queue claim mismatch (another worker likely holds claim).');
      return;
    }
    Telemetry.error('Koc Oto Kurtarma SYNC stopped', err);
    throw err;
  }
}

function main() {
  const mode = resolveRunMode();
  if (mode === 'peek') {
    mainPeekOciQueue();
  } else {
    mainSyncKocOto();
  }
}

