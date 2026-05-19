import { RETIRED_AUDIT_TABLE, RETIRED_FROM_CLAUSE, RETIRED_CLEANUP_RPC } from '../../helpers/retired-oci-vocabulary';
/**
 * FROZEN SNAPSHOT — `tests/fixtures/google-ads-oci/` only (PR-9H.7B / GCLID-first template string parity for CI).
 * OCI_FLEET_QUARANTINE — lineage: former `GoogleAdsScriptProduction.js` (removed from `scripts/google-ads-oci/`).
 * Canonical paste target: `scripts/google-ads-oci/GoogleAdsScriptUniversal.js`.
 *
 * OpsMantik Google Ads OCI — Production scheduled sync (one site / one Ads account). PR-9H.5A.
 *
 * Paste into Google Ads Script Editor. Entry: `main` (time-driven trigger).
 *
 * Script Properties (required unless noted):
 * - OPSMANTIK_SITE_ID — sites.public_id or internal UUID
 * - OPSMANTIK_API_KEY — read from Script Properties in `getScriptConfig()` (never commit; inline slot empty)
 * - OPSMANTIK_BASE_URL — default https://console.opsmantik.com
 * - OPSMANTIK_EXPORT_LIMIT — default 50 (max 1000)
 * - OPSMANTIK_RUN_MODE — peek | sync | ack-repair
 * - OPSMANTIK_OPERATOR_ID — default google-ads-script
 * - OPSMANTIK_CHANGE_TICKET — default scheduled-production
 *
 * OCI_FLEET_QUARANTINE — see scripts/google-ads-oci/fleet-quarantine.json (deprecated build template; canonical = GoogleAdsScriptUniversal.js).
 *
 * Optional (PR-9H.7A hashed-phone CSV — default off until canary verifies column header):
 * - OPSMANTIK_INCLUDE_HASHED_PHONE_IN_UPLOAD — `false` default; must be `true` to append hashed column
 * - OPSMANTIK_HASHED_PHONE_CSV_COLUMN — exact Bulk Upload CSV header string (also set inline `HASHED_PHONE_UPLOAD_COLUMN` if preferred)
 *
 * PR-9H.7B — Hashed phone CSV canary (sync only, fail-closed):
 * When `OPSMANTIK_INCLUDE_HASHED_PHONE_IN_UPLOAD=true` **and** `OPSMANTIK_RUN_MODE=sync`, the script **requires** a server-side
 * production canary bundle (same contract as `authorizeExportRequest` + `export-fetch` allowlist). No client-side sync allowlist.
 * - OPSMANTIK_HASHED_PHONE_CSV_CANARY_MODE — must be `true`
 * - OPSMANTIK_EXPORT_ALLOWLIST_IDS — exactly one canonical queue UUID
 * - OPSMANTIK_CANARY_EXPECTED_QUEUE_ID — must equal that UUID
 * - OPSMANTIK_CANARY_APPROVAL — literal `I_APPROVE_PRODUCTION_CANARY`
 * - OPSMANTIK_EXPORT_LIMIT — must be `1`
 * Headers + `canaryMode=true` + `allowlist_ids` query are sent automatically on claim fetch (`markAsExported=true`).
 *
 * Optional (peek only):
 * - OPSMANTIK_DEBUG_ALLOWLIST_IDS — comma-separated canonical UUIDs; **peek-only** client-side filter.
 *   **Forbidden in `sync` mode** — setting it with `OPSMANTIK_RUN_MODE=sync` aborts the run (prevents claim-then-drop PROCESSING rows).
 *
 * Upload authority: `offline_conversion_queue` via `GET /api/oci/google-ads-export` only.
 * Queue journal only — do not use retired audit tables as upload source. Do not log raw click ids.
 *
 * PR-9H.7A — Courier-only hashed phone: this script never receives raw phone, never hashes phone,
 * never logs hash values. Peek logs `hasHashedPhoneNumber` boolean only.
 *
 * @fileoverview Production OCI sync — not a canary script (no canary approval tokens, no CANARY_EXPECTED_QUEUE_ID).
 */

'use strict';

/**
 * PR-9H.7B — Operational classification tokens (logged on SYNC_DONE / export-run-summary; no PII).
 * @readonly
 */
var HASHED_PHONE_CSV_CANARY_GREEN = 'HASHED_PHONE_CSV_CANARY_GREEN';
var HASHED_PHONE_CSV_COLUMN_REJECTED = 'HASHED_PHONE_CSV_COLUMN_REJECTED';
var HASHED_PHONE_EXPORT_MISSING = 'HASHED_PHONE_EXPORT_MISSING';
var HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE = 'HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE';
var HASHED_PHONE_UPLOAD_SUCCEEDED_ACK_PENDING = 'HASHED_PHONE_UPLOAD_SUCCEEDED_ACK_PENDING';
var HASHED_PHONE_CANARY_PROVIDER_ERROR = 'HASHED_PHONE_CANARY_PROVIDER_ERROR';

/** Resolved in `mainSyncProduction` when sync + hashed-phone upload is enabled — server allowlist singleton (queue UUID). */
var RESOLVED_HP_CANARY_QUEUE_ID = '';

/** Leave empty — use Script Properties for OPSMANTIK_API_KEY. */
var OPSMANTIK_INLINE_SITE_ID = '';
var OPSMANTIK_INLINE_API_KEY = '';
var OPSMANTIK_INLINE_BASE_URL = '';
var OPSMANTIK_INLINE_EXPORT_LIMIT = '';
var OPSMANTIK_INLINE_RUN_MODE = '';
var OPSMANTIK_INLINE_OPERATOR_ID = '';
var OPSMANTIK_INLINE_CHANGE_TICKET = '';
/** Optional comma-separated canonical queue UUIDs for client-side row filter (debug). */
var OPSMANTIK_INLINE_DEBUG_ALLOWLIST_IDS = '';
/** Optional: `true` to append pre-hashed phone to offline CSV when `HASHED_PHONE_UPLOAD_COLUMN` / Script Property column is set — default off until canary verifies column name. */
var OPSMANTIK_INLINE_INCLUDE_HASHED_PHONE_IN_UPLOAD = '';
/** Optional: Google Bulk Upload CSV header for hashed phone column (exact name after product verification). */
var OPSMANTIK_INLINE_HASHED_PHONE_CSV_COLUMN = '';

/**
 * Inline override only (optional). If empty, falls back to Script Property `OPSMANTIK_HASHED_PHONE_CSV_COLUMN`.
 * If `OPSMANTIK_INCLUDE_HASHED_PHONE_IN_UPLOAD` is true but the effective column is empty → `HASHED_PHONE_COLUMN_NOT_CONFIGURED`.
 */
var HASHED_PHONE_UPLOAD_COLUMN = '';

/** @type {string} peek | sync | ack-repair */
var OPSMANTIK_RUN_MODE = 'peek';

var EXPORT_ID_PREFIXES = [
  'seal_',
  'won_',
  'contacted_',
  'offered_',
  'junk_exclusion_',
  'junk_',
];

var MAX_PAGES_PER_RUN = 5;
var MAX_ROWS_PER_RUN = 250;
var MAX_HTTP_RETRIES = 3;
var INITIAL_BACKOFF_MS = 1500;

function getInlineForKeys(keys) {
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
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
      key === 'OPSMANTIK_DEBUG_ALLOWLIST_IDS' &&
      typeof OPSMANTIK_INLINE_DEBUG_ALLOWLIST_IDS === 'string' &&
      OPSMANTIK_INLINE_DEBUG_ALLOWLIST_IDS.trim()
    ) {
      return OPSMANTIK_INLINE_DEBUG_ALLOWLIST_IDS.trim();
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
  }
  return '';
}

function getScriptConfig() {
  var props = null;
  try {
    if (typeof PropertiesService !== 'undefined') {
      props = PropertiesService.getScriptProperties();
    }
  } catch (e) {
    /* ignore */
  }

  var getFirst = function (keys, fallback) {
    var inline = getInlineForKeys(keys);
    if (inline) return inline;
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      if (props && props.getProperty && props.getProperty(k)) {
        return props.getProperty(k);
      }
      if (typeof process !== 'undefined' && process.env && process.env[k]) {
        return process.env[k];
      }
    }
    return fallback || '';
  };

  var limitRaw = getFirst(['OPSMANTIK_EXPORT_LIMIT'], '50');
  var limitNum = parseInt(String(limitRaw), 10);
  var limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.min(1000, limitNum) : 50;

  var includeHpRaw = getFirst(['OPSMANTIK_INCLUDE_HASHED_PHONE_IN_UPLOAD'], '');
  var csvCanaryRaw = getFirst(['OPSMANTIK_HASHED_PHONE_CSV_CANARY_MODE'], '');

  return {
    SITE_ID: getFirst(['OPSMANTIK_SITE_ID', 'OCI_SITE_ID'], ''),
    API_KEY: getFirst(['OPSMANTIK_API_KEY', 'OCI_API_KEY'], ''),
    BASE_URL: getFirst(['OPSMANTIK_BASE_URL', 'OCI_BASE_URL'], '') || 'https://console.opsmantik.com',
    LIMIT: limit,
    RUN_MODE: getFirst(
      ['OPSMANTIK_RUN_MODE'],
      typeof OPSMANTIK_RUN_MODE === 'string' && OPSMANTIK_RUN_MODE.trim() ? OPSMANTIK_RUN_MODE.trim() : 'peek'
    ),
    OPERATOR_ID: getFirst(['OPSMANTIK_OPERATOR_ID'], 'google-ads-script'),
    CHANGE_TICKET: getFirst(['OPSMANTIK_CHANGE_TICKET'], 'scheduled-production'),
    DEBUG_ALLOWLIST_RAW: getFirst(['OPSMANTIK_DEBUG_ALLOWLIST_IDS'], ''),
    INCLUDE_HASHED_PHONE_IN_UPLOAD: /^true$/i.test(String(includeHpRaw || '').trim()),
    HASHED_PHONE_CSV_COLUMN: getFirst(['OPSMANTIK_HASHED_PHONE_CSV_COLUMN'], ''),
    HASHED_PHONE_CSV_CANARY_MODE: /^true$/i.test(String(csvCanaryRaw || '').trim()),
    EXPORT_ALLOWLIST_IDS_RAW: getFirst(['OPSMANTIK_EXPORT_ALLOWLIST_IDS'], ''),
    CANARY_EXPECTED_QUEUE_ID: getFirst(['OPSMANTIK_CANARY_EXPECTED_QUEUE_ID'], ''),
    CANARY_APPROVAL_TOKEN: String(getFirst(['OPSMANTIK_CANARY_APPROVAL'], '')).trim(),
    HTTP: {
      MAX_RETRIES: MAX_HTTP_RETRIES,
      INITIAL_DELAY_MS: INITIAL_BACKOFF_MS,
    },
  };
}

var CONFIG = getScriptConfig();

/** Field order for resolving export / queue identity from API payloads. */
var RAW_QUEUE_ID_KEYS = [
  'id',
  'queue_id',
  'queueId',
  'queueID',
  'offline_conversion_queue_id',
  'offlineConversionQueueId',
  'offlineConversionQueueID',
  'oci_queue_id',
  'ociQueueId',
];

function coalesceFirstString(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (obj[k] != null && String(obj[k]).trim()) {
      return String(obj[k]).trim();
    }
  }
  return '';
}

/**
 * PR-9H.7A: accept server-prehashed phone only (`hashedPhoneNumber` / `userIdentifiers` type `hashed_phone`).
 * Returns lowercase 64-char hex or '' — never derive from raw phone in script.
 */
function extractVerifiedHashedPhoneCourier(src) {
  if (!src || typeof src !== 'object') return '';
  var candidates = [];
  if (typeof src.hashedPhoneNumber === 'string' && src.hashedPhoneNumber.trim()) {
    candidates.push(src.hashedPhoneNumber.trim().toLowerCase());
  }
  if (typeof src.hashed_phone_number === 'string' && src.hashed_phone_number.trim()) {
    candidates.push(src.hashed_phone_number.trim().toLowerCase());
  }
  var list = src.userIdentifiers || src.user_identifiers;
  if (list && list.length) {
    for (var ui = 0; ui < list.length; ui++) {
      var ent = list[ui] || {};
      var tpe = String(ent.type || '').trim().toLowerCase();
      if (tpe === 'hashed_phone' && ent.value != null && String(ent.value).trim()) {
        candidates.push(String(ent.value).trim().toLowerCase());
      }
    }
  }
  for (var j = 0; j < candidates.length; j++) {
    if (/^[a-f0-9]{64}$/.test(candidates[j])) return candidates[j];
  }
  return '';
}

/** Effective CSV header for hashed phone when upload flag is enabled (inline const or Script Property). */
function resolveHashedPhoneCsvColumnName() {
  var fromConst = typeof HASHED_PHONE_UPLOAD_COLUMN === 'string' ? HASHED_PHONE_UPLOAD_COLUMN.trim() : '';
  if (fromConst) return fromConst;
  return String((CONFIG && CONFIG.HASHED_PHONE_CSV_COLUMN) || '').trim();
}

/** Raw export id for ACK / Order ID (e.g. seal_…). Supports normalized row (`rawId`) or API shapes. */
function getRawRowId(row) {
  if (!row || typeof row !== 'object') return '';
  if (row.rawId != null && String(row.rawId).trim()) {
    return String(row.rawId).trim();
  }
  return coalesceFirstString(row, RAW_QUEUE_ID_KEYS);
}

function stripKnownExportIdPrefix(value) {
  var s = String(value || '').trim();
  if (!s) return '';
  for (var i = 0; i < EXPORT_ID_PREFIXES.length; i++) {
    var p = EXPORT_ID_PREFIXES[i];
    if (s.indexOf(p) === 0) {
      return s.slice(p.length);
    }
  }
  return s;
}

/** Canonical UUID suffix / id for logs only — never send bare UUID to /api/oci/ack. */
function getCanonicalQueueId(row) {
  if (row && row.canonicalQueueId != null && String(row.canonicalQueueId).trim()) {
    return String(row.canonicalQueueId).trim();
  }
  return stripKnownExportIdPrefix(getRawRowId(row));
}

/**
 * Unified row shape (camelCase + snake_case sources). `rawId` is the prefixed export id when present.
 */
function normalizeExportRow(source) {
  var r = source && typeof source === 'object' ? source : {};
  var rawId = coalesceFirstString(r, RAW_QUEUE_ID_KEYS);
  var gclid = r.gclid != null && String(r.gclid).trim() ? String(r.gclid).trim() : '';
  var wbraid = r.wbraid != null && String(r.wbraid).trim() ? String(r.wbraid).trim() : '';
  var gbraid = r.gbraid != null && String(r.gbraid).trim() ? String(r.gbraid).trim() : '';
  var conversionName = String(r.conversionName || r.conversion_name || '').trim();
  var conversionTime = String(r.conversionTime || r.conversion_time || '').trim();
  var conversionValue = r.conversionValue != null ? r.conversionValue : r.conversion_value;
  var conversionCurrency = String(r.conversionCurrency || r.conversion_currency || '').trim();
  var orderId = String(r.orderId || r.order_id || rawId || '').trim();
  var hashedPhoneNumber = extractVerifiedHashedPhoneCourier(r);

  return {
    rawId: rawId,
    id: rawId,
    canonicalQueueId: stripKnownExportIdPrefix(rawId),
    gclid: gclid,
    wbraid: wbraid,
    gbraid: gbraid,
    conversionName: conversionName,
    conversionTime: conversionTime,
    conversionValue: conversionValue,
    conversionCurrency: conversionCurrency,
    orderId: orderId,
    hashedPhoneNumber: hashedPhoneNumber,
  };
}

function parseDebugAllowlistSet(raw) {
  var csv = String(raw || '').trim();
  if (!csv) return null;
  var set = {};
  var parts = csv.split(',');
  for (var i = 0; i < parts.length; i++) {
    var id = String(parts[i] || '').trim();
    if (id) set[id] = true;
  }
  var keys = Object.keys(set);
  return keys.length ? set : null;
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
  },
};

var Validator = {
  isValidGoogleAdsTime: function (timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return false;
    var s = timeStr.trim();
    if (/^\d{8} \d{6}$/.test(s)) return true;
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:?\d{2}$/.test(s);
  },
  normalizeGoogleAdsTime: function (timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return '';
    var s = timeStr.trim();
    if (/^\d{8} \d{6}$/.test(s)) return s;
    return s.replace(/([+-]\d{2}):(\d{2})$/, '$1$2');
  },
};

function normalizeMoney(value) {
  var num = parseFloat(String(value || 0).replace(/[^\d.-]/g, '')) || 0;
  return Math.round(num * 100) / 100;
}

/**
 * Classify Google Ads upload.apply exception for ACK_FAILED category.
 */
function classifyUploadExceptionMessage(msg) {
  var m = String(msg || '').toLowerCase();
  if (m.indexOf('auth') >= 0 || m.indexOf('permission') >= 0 || m.indexOf('oauth') >= 0) {
    return 'AUTH';
  }
  if (m.indexOf('rate') >= 0 || m.indexOf('quota') >= 0 || m.indexOf('throttl') >= 0) {
    return 'RATE_LIMIT';
  }
  if (m.indexOf('invalid') >= 0 || m.indexOf('validation') >= 0 || m.indexOf('format') >= 0) {
    return 'VALIDATION';
  }
  return 'TRANSIENT';
}

/**
 * PR-9H.7B: map Google Bulk Upload rejection text → column contract vs generic provider fault.
 */
function classifyHashedPhoneUploadApplyError(uploadErrorMessage) {
  var m = String(uploadErrorMessage || '').toLowerCase();
  if (
    m.indexOf('column') >= 0 ||
    m.indexOf('header') >= 0 ||
    m.indexOf('unknown field') >= 0 ||
    m.indexOf('invalid field') >= 0
  ) {
    return HASHED_PHONE_CSV_COLUMN_REJECTED;
  }
  return HASHED_PHONE_CANARY_PROVIDER_ERROR;
}

/**
 * PR-9H.7B: sync + hashed phone CSV upload requires production canary allowlist bundle (same as `/api/oci/google-ads-export` guards).
 */
function validateHashedPhoneCsvCanaryForSync(cfg) {
  if (!cfg.INCLUDE_HASHED_PHONE_IN_UPLOAD) return '';
  if (!cfg.HASHED_PHONE_CSV_CANARY_MODE) {
    throw new Error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE);
  }
  if (cfg.LIMIT !== 1) {
    throw new Error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE);
  }
  var parts = String(cfg.EXPORT_ALLOWLIST_IDS_RAW || '')
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
  var qid = parts[0];
  var expected = String(cfg.CANARY_EXPECTED_QUEUE_ID || '').trim();
  if (!expected || expected !== qid) {
    throw new Error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE);
  }
  if (String(cfg.CANARY_APPROVAL_TOKEN || '').trim() !== 'I_APPROVE_PRODUCTION_CANARY') {
    throw new Error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE);
  }
  return qid;
}

/**
 * Production v1: **gclid only** for Google offline CSV (Scripts). wbraid/gbraid-only rows are classified, not uploaded.
 * Optional `hashedPhoneNumber` (64-char hex from API) is courier metadata / future EC column only — it does not replace gclid for v1.
 */
function validateProductionRow(row, csvCanaryStrict) {
  var strict = csvCanaryStrict === true;
  var rawId = getRawRowId(row);
  if (!rawId) {
    return { valid: false, reason: 'MISSING_RAW_EXPORT_ID' };
  }
  if (!row.gclid || !String(row.gclid).trim()) {
    if ((row.wbraid && String(row.wbraid).trim()) || (row.gbraid && String(row.gbraid).trim())) {
      return { valid: false, reason: 'UNSUPPORTED_CLICK_ID_FOR_SCRIPT_V1' };
    }
    return { valid: false, reason: 'MISSING_CLICK_ID' };
  }
  if (!row.conversionTime) {
    return { valid: false, reason: 'MISSING_TIME' };
  }
  if (!Validator.isValidGoogleAdsTime(row.conversionTime)) {
    return { valid: false, reason: 'INVALID_TIME_FORMAT' };
  }
  var convName = String(row.conversionName || '').trim();
  if (!convName) {
    return { valid: false, reason: 'MISSING_CONVERSION_NAME' };
  }
  var cur = String(row.conversionCurrency || '').trim();
  if (!cur) {
    return { valid: false, reason: 'MISSING_CURRENCY' };
  }
  if (strict && !extractVerifiedHashedPhoneCourier(row)) {
    return { valid: false, reason: HASHED_PHONE_EXPORT_MISSING };
  }
  return { valid: true, reason: null };
}

function ProductionClient(baseUrl, apiKey) {
  this.baseUrl = baseUrl.replace(/\/+$/, '');
  this.apiKey = apiKey;
  this.sessionToken = null;
  this.siteId = null;
}

ProductionClient.prototype._isUnauthorized = function (err) {
  var msg = err && err.message ? String(err.message) : String(err || '');
  return msg.indexOf('HTTP_401') >= 0 || msg.indexOf('HTTP_403') >= 0;
};

function isTerminalHttpOrScriptError(err) {
  var msg = err && err.message ? String(err.message) : String(err || '');
  if (/^HTTP_(400|401|403|409)\b/.test(msg)) return true;
  if (msg.indexOf('CANARY_EXPORT_BLOCKED') >= 0) return true;
  if (msg.indexOf('ACK_UNKNOWN_PREFIX') >= 0) return true;
  return false;
}

ProductionClient.prototype._fetchWithBackoff = function (url, options, retryPolicy) {
  var policy = retryPolicy || { retry5xx: true, retry429: true };
  var attempt = 0;
  var delay = CONFIG.HTTP.INITIAL_DELAY_MS;

  while (attempt < CONFIG.HTTP.MAX_RETRIES) {
    try {
      var response = UrlFetchApp.fetch(url, Object.assign({}, options, { muteHttpExceptions: true }));
      var code = response.getResponseCode();
      var body = response.getContentText() || '';

      if (code >= 200 && code < 300) {
        return response;
      }

      if (code === 409) {
        try {
          var j = JSON.parse(body);
          if (j && j.code === 'CANARY_EXPORT_BLOCKED') {
            throw new Error('HTTP_409:CANARY_EXPORT_BLOCKED:' + body.slice(0, 400));
          }
        } catch (parseErr) {
          /* fall through */
        }
      }

      if (code === 400 || code === 401 || code === 403 || code === 409) {
        throw new Error('HTTP_' + code + ':' + body.slice(0, 800));
      }

      if (code === 429 && policy.retry429) {
        Telemetry.warn('HTTP retry', { code: code, attempt: attempt + 1 });
      } else if (code >= 500 && policy.retry5xx) {
        Telemetry.warn('HTTP retry', { code: code, attempt: attempt + 1 });
      } else {
        throw new Error('HTTP_' + code + ':' + body.slice(0, 800));
      }
    } catch (err) {
      if (isTerminalHttpOrScriptError(err)) {
        throw err;
      }
      if (attempt === CONFIG.HTTP.MAX_RETRIES - 1) {
        throw err;
      }
      Telemetry.warn('Network retry', { attempt: attempt + 1, err: String(err && err.message ? err.message : err) });
    }

    attempt++;
    Utilities.sleep(delay + Math.floor(Math.random() * 400));
    delay *= 2;
  }

  throw new Error('Max retries exceeded: ' + url);
};

ProductionClient.prototype._fetchWithSessionRetry = function (url, options, retryPolicy) {
  try {
    return this._fetchWithBackoff(url, options, retryPolicy);
  } catch (err) {
    if (!this.sessionToken || !this.siteId || !this._isUnauthorized(err)) {
      throw err;
    }
    Telemetry.warn('Session expired; renewing handshake', {});
    this.verifyHandshake(this.siteId);
    var nextHeaders = Object.assign({}, options && options.headers ? options.headers : {});
    if (nextHeaders.Authorization) {
      nextHeaders.Authorization = 'Bearer ' + this.sessionToken;
    }
    if (nextHeaders['x-oci-signature'] && options.payload && this.apiKey) {
      nextHeaders['x-oci-signature'] = this._computeHexSignature(options.payload, this.apiKey);
    }
    return this._fetchWithBackoff(
      url,
      Object.assign({}, options, { headers: nextHeaders }),
      retryPolicy
    );
  }
};

ProductionClient.prototype._computeHexSignature = function (payload, secret) {
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
    return '';
  }
};

ProductionClient.prototype.verifyHandshake = function (siteId) {
  this.siteId = siteId;
  var url = this.baseUrl + '/api/oci/v2/verify';
  var response = this._fetchWithBackoff(url, {
    method: 'post',
    headers: {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify({ siteId: siteId }),
  });
  var data = JSON.parse(response.getContentText() || '{}');
  if (!data.session_token) {
    throw new Error('Handshake failed: session_token missing');
  }
  this.sessionToken = data.session_token;
};

/**
 * GET export page — production: no canary headers, no canary approval.
 * @param {number|undefined} limitOverride — per-request limit (must match remaining row budget; avoids claim-then-slice).
 */
ProductionClient.prototype.fetchPage = function (siteId, cursor, markAsExported, limitOverride) {
  var doMark = markAsExported !== false;
  var lim =
    limitOverride != null && Number(limitOverride) > 0
      ? Math.min(1000, Math.floor(Number(limitOverride)))
      : CONFIG.LIMIT;
  var url =
    this.baseUrl +
    '/api/oci/google-ads-export?siteId=' +
    encodeURIComponent(siteId) +
    '&markAsExported=' +
    (doMark ? 'true' : 'false') +
    '&limit=' +
    encodeURIComponent(String(lim));
  if (cursor) {
    url += '&cursor=' + encodeURIComponent(cursor);
  }

  /** PR-9H.7B: server-side allowlist + approval headers (never client-only sync filter). */
  var hpCanaryFetch =
    RESOLVED_HP_CANARY_QUEUE_ID &&
    doMark &&
    CONFIG &&
    CONFIG.INCLUDE_HASHED_PHONE_IN_UPLOAD &&
    CONFIG.HASHED_PHONE_CSV_CANARY_MODE;
  if (hpCanaryFetch) {
    url += '&canaryMode=true';
    url += '&allowlist_ids=' + encodeURIComponent(String(RESOLVED_HP_CANARY_QUEUE_ID));
  }

  var getHeaders = {
    Authorization: 'Bearer ' + this.sessionToken,
    Accept: 'application/json',
  };
  if (hpCanaryFetch && CONFIG.CANARY_APPROVAL_TOKEN === 'I_APPROVE_PRODUCTION_CANARY') {
    getHeaders['x-opsmantik-canary-mode'] = 'true';
    getHeaders['x-opsmantik-canary-approval'] = CONFIG.CANARY_APPROVAL_TOKEN;
    getHeaders['x-opsmantik-canary-site-id'] = String(siteId);
    getHeaders['x-opsmantik-canary-max-batch-size'] = '1';
    getHeaders['x-opsmantik-canary-expected-queue-id'] = String(RESOLVED_HP_CANARY_QUEUE_ID);
    getHeaders['x-opsmantik-change-ticket'] = String(CONFIG.CHANGE_TICKET || 'hashed-phone-csv-canary');
    getHeaders['x-opsmantik-operator-id'] = String(CONFIG.OPERATOR_ID || 'google-ads-script');
    getHeaders['x-opsmantik-allowlist-ids'] = String(RESOLVED_HP_CANARY_QUEUE_ID);
  }

  var response = this._fetchWithSessionRetry(
    url,
    {
      method: 'get',
      headers: getHeaders,
    },
    { retry5xx: true, retry429: true }
  );

  var payload = JSON.parse(response.getContentText() || '{}');
  var items = [];
  if (Array.isArray(payload)) {
    items = payload;
  } else if (Array.isArray(payload.data)) {
    items = payload.data;
  } else if (Array.isArray(payload.items)) {
    items = payload.items;
  }

  var nextCursor =
    payload && payload.meta && payload.meta.nextCursor
      ? payload.meta.nextCursor
      : payload.next_cursor || null;
  var hasNextPage =
    payload && payload.meta && typeof payload.meta === 'object'
      ? payload.meta.hasNextPage === true
      : !!nextCursor;

  return {
    items: items,
    nextCursor: nextCursor,
    hasNextPage: hasNextPage,
    counts: payload.counts || null,
    exportRunId: payload.export_run_id || null,
    markAsExported: typeof payload.markAsExported === 'boolean' ? payload.markAsExported : doMark,
  };
};

/**
 * POST /api/oci/ack — queueIds must be raw export ids (e.g. seal_*). exportRunId from export response.
 * Does not retry 400 ACK_UNKNOWN_PREFIX (terminal for this request).
 */
ProductionClient.prototype.sendAck = function (siteId, queueIds, exportRunId) {
  var q = queueIds || [];
  if (!q.length) return { ok: false, skipped: true };

  var payload = { siteId: siteId, queueIds: q };
  // OCI Truth: bulk upload dispatch is not provider confirmation — match Koç / API ACK semantics.
  payload.pendingConfirmation = true;
  payload.providerConfirmationMode = 'bulk_upload_async_unconfirmed';
  if (exportRunId) {
    payload.export_run_id = exportRunId;
    payload.exportRunId = exportRunId;
  }
  var payloadStr = JSON.stringify(payload);
  var url = this.baseUrl + '/api/oci/ack';

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + this.sessionToken,
      'Content-Type': 'application/json',
      'x-oci-signature': this._computeHexSignature(payloadStr, this.apiKey),
    },
    payload: payloadStr,
    muteHttpExceptions: true,
  });

  var code = response.getResponseCode();
  var text = response.getContentText() || '';

  if (code >= 200 && code < 300) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return { ok: false, parse_error: true, raw: text.slice(0, 500) };
    }
  }

  if (code === 400 && text.indexOf('ACK_UNKNOWN_PREFIX') >= 0) {
    return { ok: false, httpCode: code, terminal: true, code: 'ACK_UNKNOWN_PREFIX', body: text.slice(0, 800) };
  }

  return { ok: false, httpCode: code, body: text.slice(0, 800) };
};

ProductionClient.prototype.sendAckFailed = function (siteId, queueIds, errorCode, errorMessage, errorCategory, exportRunId) {
  if (!queueIds || !queueIds.length) return null;
  var bodyObj = {
    siteId: siteId,
    queueIds: queueIds,
    errorCode: errorCode || 'UNKNOWN',
    errorMessage: errorMessage || errorCode || 'UNKNOWN',
    errorCategory: errorCategory || 'TRANSIENT',
  };
  if (exportRunId) {
    bodyObj.export_run_id = exportRunId;
    bodyObj.exportRunId = exportRunId;
  }
  var payload = JSON.stringify(bodyObj);
  var url = this.baseUrl + '/api/oci/ack-failed';

  var response = this._fetchWithSessionRetry(
    url,
    {
      method: 'post',
      headers: {
        Authorization: 'Bearer ' + this.sessionToken,
        'Content-Type': 'application/json',
        'x-oci-signature': this._computeHexSignature(payload, this.apiKey),
      },
      payload: payload,
    },
    { retry5xx: true, retry429: true }
  );

  try {
    return JSON.parse(response.getContentText() || '{}');
  } catch (e) {
    return { ok: false };
  }
};

ProductionClient.prototype.sendSummary = function (summaryPayload) {
  try {
    var url = this.baseUrl + '/api/oci/export-run-summary';
    var payloadStr = JSON.stringify(summaryPayload);
    var headers = {
      Authorization: 'Bearer ' + this.sessionToken,
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['x-oci-signature'] = this._computeHexSignature(payloadStr, this.apiKey);
    }
    var response = this._fetchWithSessionRetry(
      url,
      {
        method: 'post',
        headers: headers,
        payload: payloadStr,
      },
      { retry5xx: true, retry429: true }
    );
    return JSON.parse(response.getContentText() || '{}');
  } catch (err) {
    Telemetry.warn('export-run-summary failed', { err: String(err && err.message ? err.message : err) });
    return { ok: false };
  }
};

function logPeekRow(row) {
  var norm = normalizeExportRow(row);
  var rawId = getRawRowId(norm);
  var canon = getCanonicalQueueId(norm);
  Telemetry.info('PEEK_ROW', {
    rawExportId: rawId,
    canonicalQueueIdSuffix: canon.length > 8 ? canon.slice(-8) : canon,
    conversionName: norm.conversionName || '',
    value: norm.conversionValue,
    currency: norm.conversionCurrency || '',
    conversionTime: norm.conversionTime || '',
    hasGclid: Boolean(norm.gclid),
    hasWbraid: Boolean(norm.wbraid),
    hasGbraid: Boolean(norm.gbraid),
    hasHashedPhoneNumber: Boolean(norm.hashedPhoneNumber),
  });
}

/**
 * Upload one page of rows. ACK uses raw export ids only.
 * On upload success + ACK failure: UPLOAD_SUCCEEDED_ACK_PENDING — no ACK_FAILED, no re-upload.
 */
function processProductionPageUpload(rows, exportRunId, client, siteId) {
  var includeHp = CONFIG && CONFIG.INCLUDE_HASHED_PHONE_IN_UPLOAD === true;
  var hpColName = resolveHashedPhoneCsvColumnName();
  var csvCanaryStrict = Boolean(RESOLVED_HP_CANARY_QUEUE_ID);
  if (csvCanaryStrict && rows.length !== 1) {
    Telemetry.error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE, { row_count: rows.length });
    throw new Error(HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE);
  }

  /** PR-9H.7B: classification labels differentiate full production vs hashed-phone CSV canary. */
  var ackPendingCanon = csvCanaryStrict && includeHp ? HASHED_PHONE_UPLOAD_SUCCEEDED_ACK_PENDING : 'UPLOAD_SUCCEEDED_ACK_PENDING';
  var syncGreenCanon = csvCanaryStrict && includeHp ? HASHED_PHONE_CSV_CANARY_GREEN : 'SYNC_GREEN';

  var timezone = AdsApp.currentAccount().getTimeZone() || 'Europe/Istanbul';
  var baseHeaders = [
    'Order ID',
    'Google Click ID',
    'Conversion name',
    'Conversion time',
    'Conversion value',
    'Conversion currency',
  ];
  var headers = baseHeaders.slice();
  if (includeHp) {
    headers.push(hpColName);
  }
  var upload = AdsApp.bulkUploads().newCsvUpload(headers, { moneyInMicros: false, timeZone: timezone });
  upload.forOfflineConversions();
  upload.setFileName('OpsMantik_Production_' + new Date().toISOString() + '.csv');

  var stats = {
    operationalLabel: 'SYNC_GREEN',
    uploaded: 0,
    rawSuccessIds: [],
    validationFailed: [],
    uploadThrew: false,
    uploadErrorMessage: '',
  };

  var toUpload = [];

  for (var i = 0; i < rows.length; i++) {
    var row = normalizeExportRow(rows[i]);
    var v = validateProductionRow(row, csvCanaryStrict);
    var rawId = getRawRowId(row);

    if (!v.valid) {
      stats.validationFailed.push({
        queueId: rawId,
        errorCode: v.reason,
        errorMessage: v.reason,
        errorCategory: 'VALIDATION',
      });
      continue;
    }

    var gclidOnly = String(row.gclid || '').trim();
    var conversionValue = normalizeMoney(row.conversionValue);
    var conversionName = String(row.conversionName || '').trim();
    var currency = String(row.conversionCurrency || 'TRY').toUpperCase();
    var orderId = String(rawId).slice(0, 64);

    toUpload.push({
      row: row,
      rawId: rawId,
      orderId: orderId,
      clickId: gclidOnly,
      conversionName: conversionName,
      currency: currency,
      conversionValue: conversionValue,
    });
  }

  var vfIds = [];
  if (stats.validationFailed.length > 0) {
    vfIds = stats.validationFailed
      .map(function (x) {
        return x.queueId;
      })
      .filter(function (id) {
        return id;
      });
    if (vfIds.length === 0) {
      Telemetry.warn('VALIDATION_FAILED_WITHOUT_ACKABLE_RAW_ID', {
        validation_failed_count: stats.validationFailed.length,
        export_run_id: exportRunId || null,
      });
    } else {
      try {
        client.sendAckFailed(siteId, vfIds, 'VALIDATION_ROW', 'VALIDATION_ROW', 'VALIDATION', exportRunId);
      } catch (e) {
        Telemetry.error('sendAckFailed validation', e);
      }
    }
  }
  var hadValidationWithoutAckableRawId = stats.validationFailed.length > 0 && vfIds.length === 0;

  for (var j = 0; j < toUpload.length; j++) {
    var item = toUpload[j];
    var rowAppend = {
      'Order ID': item.orderId,
      'Google Click ID': item.clickId,
      'Conversion name': item.conversionName,
      'Conversion time': Validator.normalizeGoogleAdsTime(item.row.conversionTime),
      'Conversion value': item.conversionValue,
      'Conversion currency': item.currency,
    };
    if (includeHp) {
      var hpVal = String(item.row.hashedPhoneNumber || '').trim();
      rowAppend[hpColName] = /^[a-f0-9]{64}$/i.test(hpVal) ? hpVal.toLowerCase() : '';
    }
    upload.append(rowAppend);
    stats.rawSuccessIds.push(item.rawId);
    stats.uploaded++;
  }

  if (stats.uploaded === 0) {
    if (hadValidationWithoutAckableRawId) {
      stats.operationalLabel = 'CLAIMED_ROW_WITHOUT_ACKABLE_ID';
    } else if (stats.validationFailed.length > 0) {
      var allHpMiss = true;
      for (var zi = 0; zi < stats.validationFailed.length; zi++) {
        if (stats.validationFailed[zi].errorCode !== HASHED_PHONE_EXPORT_MISSING) {
          allHpMiss = false;
          break;
        }
      }
      stats.operationalLabel =
        csvCanaryStrict && allHpMiss ? HASHED_PHONE_EXPORT_MISSING : 'VALIDATION_FAILED_ACK_FAILED';
    } else {
      stats.operationalLabel = 'SYNC_GREEN';
    }
    return stats;
  }

  try {
    Telemetry.info('Google Ads upload.apply starting', { uploadedRows: stats.uploaded });
    upload.apply();
    Telemetry.info('Google Ads upload.apply completed', { uploadedRows: stats.uploaded });
  } catch (err) {
    stats.uploadThrew = true;
    stats.uploadErrorMessage = err && err.message ? String(err.message).slice(0, 500) : 'UPLOAD_EXCEPTION';
    Telemetry.error('Google Ads upload.apply failed', err);
    var cat = classifyUploadExceptionMessage(stats.uploadErrorMessage);
    try {
      client.sendAckFailed(siteId, stats.rawSuccessIds, 'UPLOAD_EXCEPTION', stats.uploadErrorMessage, cat, exportRunId);
    } catch (e2) {
      Telemetry.error('sendAckFailed after upload throw', e2);
    }
    if (csvCanaryStrict && includeHp) {
      if (cat === 'AUTH') {
        stats.operationalLabel = 'AUTH_FAILED';
      } else if (cat === 'RATE_LIMIT') {
        stats.operationalLabel = 'RATE_LIMITED';
      } else if (
        classifyHashedPhoneUploadApplyError(stats.uploadErrorMessage) === HASHED_PHONE_CSV_COLUMN_REJECTED ||
        cat === 'VALIDATION'
      ) {
        stats.operationalLabel = HASHED_PHONE_CSV_COLUMN_REJECTED;
      } else {
        stats.operationalLabel = HASHED_PHONE_CANARY_PROVIDER_ERROR;
      }
    } else {
      stats.operationalLabel =
        cat === 'AUTH'
          ? 'AUTH_FAILED'
          : cat === 'RATE_LIMIT'
            ? 'RATE_LIMITED'
            : cat === 'VALIDATION'
              ? 'UPLOAD_FAILED_PROVIDER_CLASSIFIED'
              : 'UPLOAD_FAILED_PROVIDER_CLASSIFIED';
    }
    return stats;
  }

  var ackRes = null;
  try {
    ackRes = client.sendAck(siteId, stats.rawSuccessIds, exportRunId);
  } catch (ackErr) {
    Telemetry.warn('UPLOAD_SUCCEEDED_ACK_PENDING', {
      reason: 'ACK threw after successful upload.apply — do not ACK_FAILED or re-upload',
      err: String(ackErr && ackErr.message ? ackErr.message : ackErr),
      export_run_id: exportRunId,
    });
    stats.operationalLabel = ackPendingCanon;
    return stats;
  }

  if (ackRes && ackRes.terminal && ackRes.code === 'ACK_UNKNOWN_PREFIX') {
    Telemetry.warn('UPLOAD_SUCCEEDED_ACK_PENDING', {
      reason: 'ACK_UNKNOWN_PREFIX terminal — do not re-upload; run ack-repair lane when server exposes pending rows',
      export_run_id: exportRunId,
    });
    stats.operationalLabel = ackPendingCanon;
  } else if (ackRes && ackRes.ok === true) {
    var updatedNum = ackRes.updated != null ? Number(ackRes.updated) : NaN;
    if (Number.isFinite(updatedNum) && updatedNum >= 1) {
      stats.operationalLabel = syncGreenCanon;
      if (ackRes.warnings && ackRes.warnings.receipt_persist_warning) {
        Telemetry.warn('ACK_OK_RECEIPT_PERSIST_WARNING', { export_run_id: exportRunId });
      }
    } else {
      Telemetry.warn('UPLOAD_SUCCEEDED_ACK_PENDING', {
        reason: 'ACK ok=true but updated<1 — do not treat as SYNC_GREEN; operator review',
        updated: ackRes.updated,
        export_run_id: exportRunId,
      });
      stats.operationalLabel = ackPendingCanon;
    }
  } else if (ackRes && ackRes.ok === false) {
    Telemetry.warn('UPLOAD_SUCCEEDED_ACK_PENDING', {
      reason: 'ACK HTTP or envelope failure after successful upload.apply — do not ACK_FAILED or re-upload per production policy',
      ackRes: JSON.stringify(ackRes).slice(0, 500),
    });
    stats.operationalLabel = ackPendingCanon;
  } else {
    Telemetry.warn('UPLOAD_SUCCEEDED_ACK_PENDING', {
      reason: 'ACK response empty or unrecognized after successful upload.apply — do not ACK_FAILED or re-upload',
      ackSnippet: ackRes ? JSON.stringify(ackRes).slice(0, 500) : null,
      export_run_id: exportRunId,
    });
    stats.operationalLabel = ackPendingCanon;
  }

  if (
    stats.validationFailed.length > 0 &&
    stats.uploaded > 0 &&
    (stats.operationalLabel === 'SYNC_GREEN' || stats.operationalLabel === HASHED_PHONE_CSV_CANARY_GREEN)
  ) {
    if (hadValidationWithoutAckableRawId) {
      stats.operationalLabel = 'CLAIMED_ROW_WITHOUT_ACKABLE_ID';
    } else {
      stats.operationalLabel = 'VALIDATION_FAILED_ACK_FAILED';
    }
  }

  return stats;
}

function resolveRunMode() {
  var raw = String((CONFIG && CONFIG.RUN_MODE) || OPSMANTIK_RUN_MODE || 'peek')
    .trim()
    .toLowerCase();
  if (raw === 'peek' || raw === 'preview' || raw === 'dry') return 'peek';
  if (raw === 'ack-repair' || raw === 'ack_repair' || raw === 'ackrepair') return 'ack-repair';
  if (raw === 'sync') return 'sync';
  return 'peek';
}

function mergeOperationalWorst(current, next) {
  var rank = {
    HASHED_PHONE_UPLOAD_SUCCEEDED_ACK_PENDING: 52,
    UPLOAD_SUCCEEDED_ACK_PENDING: 50,
    HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE: 55,
    CLAIMED_ROW_WITHOUT_ACKABLE_ID: 45,
    AUTH_FAILED: 40,
    RATE_LIMITED: 40,
    HASHED_PHONE_CSV_COLUMN_REJECTED: 38,
    HASHED_PHONE_CANARY_PROVIDER_ERROR: 37,
    UPLOAD_FAILED_PROVIDER_CLASSIFIED: 35,
    HASHED_PHONE_EXPORT_MISSING: 34,
    VALIDATION_FAILED_ACK_FAILED: 30,
    HASHED_PHONE_CSV_CANARY_GREEN: 10,
    SYNC_GREEN: 10,
  };
  var rc = rank[current] != null ? rank[current] : 0;
  var rn = rank[next] != null ? rank[next] : 0;
  return rn > rc ? next : current;
}

function filterRowsByDebugAllowlist(rows, allowSet) {
  if (!allowSet) return rows;
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var norm = normalizeExportRow(r);
    var canon = norm.canonicalQueueId || getCanonicalQueueId(norm);
    if (allowSet[canon] || allowSet[norm.rawId] || allowSet[getRawRowId(norm)]) {
      out.push(r);
    }
  }
  return out;
}

function mainPeekProduction() {
  RESOLVED_HP_CANARY_QUEUE_ID = '';
  Telemetry.info('PRODUCTION_PEEK', { site: CONFIG.SITE_ID ? 'configured' : 'missing' });
  if (!CONFIG.SITE_ID || !CONFIG.API_KEY) {
    Telemetry.error('Missing OPSMANTIK_SITE_ID or OPSMANTIK_API_KEY', null);
    return;
  }
  var client = new ProductionClient(CONFIG.BASE_URL, CONFIG.API_KEY);
  client.verifyHandshake(CONFIG.SITE_ID);
  var allowSet = parseDebugAllowlistSet(CONFIG.DEBUG_ALLOWLIST_RAW);
  var cursor = null;
  var pageNo = 0;
  var total = 0;

  while (pageNo < MAX_PAGES_PER_RUN && total < MAX_ROWS_PER_RUN) {
    pageNo++;
    var remainingPeek = MAX_ROWS_PER_RUN - total;
    var pageLimitPeek = Math.min(CONFIG.LIMIT, remainingPeek);
    if (pageLimitPeek < 1) break;
    var page = client.fetchPage(CONFIG.SITE_ID, cursor, false, pageLimitPeek);
    var rows = page.items || [];
    rows = filterRowsByDebugAllowlist(rows, allowSet);
    for (var i = 0; i < rows.length; i++) {
      logPeekRow(rows[i]);
      total++;
      if (total >= MAX_ROWS_PER_RUN) break;
    }
    cursor = page.nextCursor;
    if (!(page.hasNextPage && cursor)) break;
  }
  Telemetry.info('PEEK_DONE', { pages: pageNo, rowsLogged: total });
}

function mainSyncProduction() {
  RESOLVED_HP_CANARY_QUEUE_ID = '';
  Telemetry.info('PRODUCTION_SYNC', {});
  if (!CONFIG.SITE_ID || !CONFIG.API_KEY) {
    Telemetry.error('Missing OPSMANTIK_SITE_ID or OPSMANTIK_API_KEY', null);
    return;
  }

  if (String(CONFIG.DEBUG_ALLOWLIST_RAW || '').trim()) {
    throw new Error(
      'PRODUCTION_SYNC_DEBUG_ALLOWLIST_FORBIDDEN: remove OPSMANTIK_DEBUG_ALLOWLIST_IDS for sync mode (claim-then-drop risk). Debug allowlist is peek-only until server-side allowlist is wired.'
    );
  }

  if (CONFIG.INCLUDE_HASHED_PHONE_IN_UPLOAD) {
    var effHpCol =
      (typeof HASHED_PHONE_UPLOAD_COLUMN === 'string' && HASHED_PHONE_UPLOAD_COLUMN.trim()) ||
      String(CONFIG.HASHED_PHONE_CSV_COLUMN || '').trim();
    if (!effHpCol) {
      throw new Error('HASHED_PHONE_COLUMN_NOT_CONFIGURED');
    }
    RESOLVED_HP_CANARY_QUEUE_ID = validateHashedPhoneCsvCanaryForSync(CONFIG);
  }

  var client = new ProductionClient(CONFIG.BASE_URL, CONFIG.API_KEY);
  client.verifyHandshake(CONFIG.SITE_ID);

  var summary = {
    summary_version: '1.0-production',
    generated_at: new Date().toISOString(),
    operator_id: CONFIG.OPERATOR_ID,
    change_ticket: CONFIG.CHANGE_TICKET,
    mode: 'sync',
    fetched_pages: 0,
    rows_processed: 0,
    upload_pages: 0,
    operational_final: 'SYNC_GREEN',
    upload_success_ack_pending_pages: 0,
    validation_failed: 0,
    auth_or_rate: 0,
    export_run_ids: [],
    hashed_phone_csv_canary_active: Boolean(RESOLVED_HP_CANARY_QUEUE_ID),
  };

  var cursor = null;
  var pageNo = 0;
  /** PR-9H.7B: hashed-phone CSV canary must not iterate multiple export pages — one claim batch only. */
  var maxPagesThisSync =
    RESOLVED_HP_CANARY_QUEUE_ID && CONFIG.INCLUDE_HASHED_PHONE_IN_UPLOAD ? 1 : MAX_PAGES_PER_RUN;

  while (pageNo < maxPagesThisSync && summary.rows_processed < MAX_ROWS_PER_RUN) {
    pageNo++;
    var remainingBudget = MAX_ROWS_PER_RUN - summary.rows_processed;
    var pageLimit = Math.min(CONFIG.LIMIT, remainingBudget);
    if (pageLimit < 1) {
      break;
    }

    var page = client.fetchPage(CONFIG.SITE_ID, cursor, true, pageLimit);
    summary.fetched_pages = pageNo;
    var rows = page.items || [];
    var pageExportRunId = page.exportRunId || null;

    if (pageExportRunId && summary.export_run_ids.indexOf(pageExportRunId) < 0) {
      summary.export_run_ids.push(pageExportRunId);
    }
    summary.export_run_id = pageExportRunId || summary.export_run_id || null;

    if (!rows.length) {
      break;
    }

    var stats = processProductionPageUpload(rows, pageExportRunId, client, CONFIG.SITE_ID);
    summary.rows_processed += rows.length;
    summary.upload_pages += 1;

    summary.operational_final = mergeOperationalWorst(summary.operational_final, stats.operationalLabel);

    if (
      stats.operationalLabel === 'UPLOAD_SUCCEEDED_ACK_PENDING' ||
      stats.operationalLabel === HASHED_PHONE_UPLOAD_SUCCEEDED_ACK_PENDING
    ) {
      summary.upload_success_ack_pending_pages += 1;
    }
    if (stats.validationFailed && stats.validationFailed.length > 0) {
      summary.validation_failed += stats.validationFailed.length;
    }
    if (stats.operationalLabel === 'AUTH_FAILED' || stats.operationalLabel === 'RATE_LIMITED') {
      summary.auth_or_rate += 1;
    }

    cursor = page.nextCursor;
    if (!(page.hasNextPage && cursor)) break;
  }

  try {
    client.sendSummary(summary);
  } catch (e) {
    Telemetry.warn('sendSummary tail', e);
  }

  Telemetry.info('SYNC_DONE', {
    operational_final: summary.operational_final,
    export_run_ids: summary.export_run_ids,
    last_export_run_id: summary.export_run_id,
    hashed_phone_csv_canary_active: summary.hashed_phone_csv_canary_active,
  });
}

function mainAckRepairProduction() {
  Telemetry.info('PRODUCTION_ACK_REPAIR', {
    status: 'NO_OP',
    reason:
      'Server endpoint to list upload-succeeded / ACK-pending rows for scripted repair is not wired in this script. Do not invent upload success locally. Use console/API operator flow or future GET repair contract.',
  });
}

function main() {
  CONFIG = getScriptConfig();
  var mode = resolveRunMode();

  if (mode === 'peek') {
    mainPeekProduction();
  } else if (mode === 'sync') {
    mainSyncProduction();
  } else if (mode === 'ack-repair') {
    mainAckRepairProduction();
  } else {
    mainPeekProduction();
  }
}
