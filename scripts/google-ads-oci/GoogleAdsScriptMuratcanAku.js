/**
 * OpsMantik Google Ads OCI — Muratcan Akü
 *
 * Canary-safe single-row Google Ads Offline Conversion Import script.
 *
 * This script is intentionally guarded:
 * - sync mode requires exactly one allowlisted queue id
 * - sync mode requires explicit canary upload approval
 * - sync mode refuses payloads outside the expected canary id
 * - API key should be stored in Script Properties, not inline
 */

'use strict';

/**
 * Run modes:
 * - 'peek' = preview only, markAsExported=false, no Google upload, no ACK
 * - 'sync' = export with markAsExported=true, upload to Google Ads, then ACK / ACK_FAILED
 *
 * For final canary closure, use 'sync'.
 * For one last visual check, temporarily use 'peek'.
 *
 * @type {string} peek | sync
 */
var OPSMANTIK_RUN_MODE = 'sync';

/**
 * Site id for Muratcan Akü canary.
 *
 * @type {string} sites.public_id or internal UUID
 */
var OPSMANTIK_INLINE_SITE_ID = '';

/**
 * Do not put API key inline.
 * Put the rotated key into Script Properties:
 *
 * OPSMANTIK_API_KEY = rotated_oci_api_key
 *
 * @type {string}
 */
var OPSMANTIK_INLINE_API_KEY = '';

/**
 * @type {string}
 */
var OPSMANTIK_INLINE_BASE_URL = 'https://console.opsmantik.com';

/**
 * Canary run must stay at 1.
 *
 * @type {string}
 */
var OPSMANTIK_INLINE_EXPORT_LIMIT = '1';

/**
 * Single canary queue id only.
 *
 * @type {string}
 */
var OPSMANTIK_INLINE_ALLOWLIST_IDS = '';

/**
 * Canary guard values.
 * These can be inline or Script Properties. Inline is fine because these are not secrets.
 */
var OPSMANTIK_INLINE_CANARY_EXPECTED_QUEUE_ID = '';
var OPSMANTIK_INLINE_CANARY_UPLOAD_APPROVAL = '';
var OPSMANTIK_INLINE_CANARY_EXPORT_RUN_ID = '';
var OPSMANTIK_INLINE_CHANGE_TICKET = '';
var OPSMANTIK_INLINE_OPERATOR_ID = '';
var OPSMANTIK_INLINE_CANARY_SITE_ID = '';

/**
 * Expected canary payload identity.
 */
var OPSMANTIK_INLINE_CANARY_EXPECTED_CONVERSION_NAME = 'OpsMantik_Won';
var OPSMANTIK_INLINE_CANARY_EXPECTED_VALUE = '100';
var OPSMANTIK_INLINE_CANARY_EXPECTED_CURRENCY = 'TRY';

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
      key === 'OPSMANTIK_ALLOWLIST_IDS' &&
      typeof OPSMANTIK_INLINE_ALLOWLIST_IDS === 'string' &&
      OPSMANTIK_INLINE_ALLOWLIST_IDS.trim()
    ) {
      return OPSMANTIK_INLINE_ALLOWLIST_IDS.trim();
    }

    if (
      key === 'CANARY_EXPECTED_QUEUE_ID' &&
      typeof OPSMANTIK_INLINE_CANARY_EXPECTED_QUEUE_ID === 'string' &&
      OPSMANTIK_INLINE_CANARY_EXPECTED_QUEUE_ID.trim()
    ) {
      return OPSMANTIK_INLINE_CANARY_EXPECTED_QUEUE_ID.trim();
    }

    if (
      key === 'CANARY_UPLOAD_APPROVAL' &&
      typeof OPSMANTIK_INLINE_CANARY_UPLOAD_APPROVAL === 'string' &&
      OPSMANTIK_INLINE_CANARY_UPLOAD_APPROVAL.trim()
    ) {
      return OPSMANTIK_INLINE_CANARY_UPLOAD_APPROVAL.trim();
    }

    if (
      key === 'CANARY_EXPORT_RUN_ID' &&
      typeof OPSMANTIK_INLINE_CANARY_EXPORT_RUN_ID === 'string' &&
      OPSMANTIK_INLINE_CANARY_EXPORT_RUN_ID.trim()
    ) {
      return OPSMANTIK_INLINE_CANARY_EXPORT_RUN_ID.trim();
    }

    if (
      key === 'CHANGE_TICKET' &&
      typeof OPSMANTIK_INLINE_CHANGE_TICKET === 'string' &&
      OPSMANTIK_INLINE_CHANGE_TICKET.trim()
    ) {
      return OPSMANTIK_INLINE_CHANGE_TICKET.trim();
    }

    if (
      key === 'OPERATOR_ID' &&
      typeof OPSMANTIK_INLINE_OPERATOR_ID === 'string' &&
      OPSMANTIK_INLINE_OPERATOR_ID.trim()
    ) {
      return OPSMANTIK_INLINE_OPERATOR_ID.trim();
    }

    if (
      key === 'CANARY_SITE_ID' &&
      typeof OPSMANTIK_INLINE_CANARY_SITE_ID === 'string' &&
      OPSMANTIK_INLINE_CANARY_SITE_ID.trim()
    ) {
      return OPSMANTIK_INLINE_CANARY_SITE_ID.trim();
    }

    if (
      key === 'CANARY_EXPECTED_CONVERSION_NAME' &&
      typeof OPSMANTIK_INLINE_CANARY_EXPECTED_CONVERSION_NAME === 'string' &&
      OPSMANTIK_INLINE_CANARY_EXPECTED_CONVERSION_NAME.trim()
    ) {
      return OPSMANTIK_INLINE_CANARY_EXPECTED_CONVERSION_NAME.trim();
    }

    if (
      key === 'CANARY_EXPECTED_VALUE' &&
      typeof OPSMANTIK_INLINE_CANARY_EXPECTED_VALUE === 'string' &&
      OPSMANTIK_INLINE_CANARY_EXPECTED_VALUE.trim()
    ) {
      return OPSMANTIK_INLINE_CANARY_EXPECTED_VALUE.trim();
    }

    if (
      key === 'CANARY_EXPECTED_CURRENCY' &&
      typeof OPSMANTIK_INLINE_CANARY_EXPECTED_CURRENCY === 'string' &&
      OPSMANTIK_INLINE_CANARY_EXPECTED_CURRENCY.trim()
    ) {
      return OPSMANTIK_INLINE_CANARY_EXPECTED_CURRENCY.trim();
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

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];

      if (props && props.getProperty && props.getProperty(key)) {
        return props.getProperty(key);
      }

      if (typeof process !== 'undefined' && process.env && process.env[key]) {
        return process.env[key];
      }
    }

    return fallback || '';
  };

  var limitRaw = getFirst(['OPSMANTIK_EXPORT_LIMIT'], '1');
  var limitNum = parseInt(String(limitRaw), 10);
  var limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.min(1000, limitNum) : 1;

  var isLocal = typeof require !== 'undefined' && require.main && require.main === module;

  return Object.freeze({
    SITE_ID: getFirst(['OPSMANTIK_SITE_ID', 'OCI_SITE_ID'], '') || (isLocal ? 'mock-public-id' : ''),
    API_KEY: getFirst(['OPSMANTIK_API_KEY', 'OCI_API_KEY'], '') || (isLocal ? 'mock-key' : ''),
    BASE_URL: getFirst(['OPSMANTIK_BASE_URL', 'OCI_BASE_URL'], '') || 'https://console.opsmantik.com',
    ALLOWLIST_IDS: getFirst(['OPSMANTIK_ALLOWLIST_IDS'], ''),
    CANARY_EXPECTED_QUEUE_ID: getFirst(['CANARY_EXPECTED_QUEUE_ID'], ''),
    CANARY_UPLOAD_APPROVAL: getFirst(['CANARY_UPLOAD_APPROVAL'], ''),
    CANARY_EXPORT_RUN_ID: getFirst(['CANARY_EXPORT_RUN_ID'], ''),
    CHANGE_TICKET: getFirst(['CHANGE_TICKET'], ''),
    OPERATOR_ID: getFirst(['OPERATOR_ID'], ''),
    CANARY_SITE_ID: getFirst(['CANARY_SITE_ID'], ''),
    CANARY_EXPECTED_CONVERSION_NAME: getFirst(['CANARY_EXPECTED_CONVERSION_NAME'], 'OpsMantik_Won'),
    CANARY_EXPECTED_VALUE: getFirst(['CANARY_EXPECTED_VALUE'], '100'),
    CANARY_EXPECTED_CURRENCY: getFirst(['CANARY_EXPECTED_CURRENCY'], 'TRY'),
    LIMIT: limit,
    HTTP: Object.freeze({
      MAX_RETRIES: 5,
      INITIAL_DELAY_MS: 1500,
    }),
  });
}

var CONFIG = getScriptConfig();

function parseAllowlistIds(raw) {
  var value = (raw || '').trim();
  if (!value) return null;

  var parts = value.split(',');
  var set = new Set();

  for (var i = 0; i < parts.length; i++) {
    var item = String(parts[i] || '').trim();
    if (item.length > 0) set.add(item);
  }

  return set.size > 0 ? set : null;
}

/**
 * SSOT literals — lib/domain/mizan-mantik/conversion-names.ts
 */
var CONVERSION_EVENTS = Object.freeze({
  CONTACTED: 'OpsMantik_Contacted',
  OFFERED: 'OpsMantik_Offered',
  WON: 'OpsMantik_Won',
  JUNK_EXCLUSION: 'OpsMantik_Junk_Exclusion',
});

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

  analyze: function (row) {
    var clickId = row.gclid || row.wbraid || row.gbraid;

    if (!clickId) return { valid: false, reason: 'MISSING_CLICK_ID' };
    if (!row.conversionTime) return { valid: false, reason: 'MISSING_TIME' };
    if (!this.isValidGoogleAdsTime(row.conversionTime)) {
      return { valid: false, reason: 'INVALID_TIME_FORMAT' };
    }

    return { valid: true, clickId: clickId };
  },
};

function normalizeMoney(value) {
  var num = parseFloat(String(value || 0).replace(/[^\d.-]/g, '')) || 0;
  return Math.round(num * 100) / 100;
}

function assertCanaryPayload(row) {
  if (!row || !row.id) {
    throw new Error('CANARY_ROW_MISSING_ID');
  }

  var expectedId = CONFIG.CANARY_EXPECTED_QUEUE_ID;
  if (String(row.id) !== String(expectedId)) {
    throw new Error('CANARY_ROW_ID_MISMATCH expected=' + expectedId + ' actual=' + String(row.id));
  }

  var actualConversionName = String(row.conversionName || '').trim();
  var expectedConversionName = String(CONFIG.CANARY_EXPECTED_CONVERSION_NAME || 'OpsMantik_Won').trim();

  if (actualConversionName !== expectedConversionName) {
    throw new Error(
      'CANARY_CONVERSION_NAME_MISMATCH expected=' +
        expectedConversionName +
        ' actual=' +
        actualConversionName
    );
  }

  var actualCurrency = String(row.conversionCurrency || 'TRY').trim().toUpperCase();
  var expectedCurrency = String(CONFIG.CANARY_EXPECTED_CURRENCY || 'TRY').trim().toUpperCase();

  if (actualCurrency !== expectedCurrency) {
    throw new Error('CANARY_CURRENCY_MISMATCH expected=' + expectedCurrency + ' actual=' + actualCurrency);
  }

  var actualValue = normalizeMoney(row.conversionValue);
  var expectedValue = normalizeMoney(CONFIG.CANARY_EXPECTED_VALUE || '100');

  if (actualValue !== expectedValue) {
    throw new Error('CANARY_VALUE_MISMATCH expected=' + expectedValue + ' actual=' + actualValue);
  }

  var clickCheck = Validator.analyze(row);
  if (!clickCheck.valid) {
    throw new Error('CANARY_PAYLOAD_NOT_UPLOADABLE reason=' + clickCheck.reason);
  }

  return true;
}

function MuratcanClient(baseUrl, apiKey) {
  this.baseUrl = baseUrl.replace(/\/+$/, '');
  this.apiKey = apiKey;
  this.sessionToken = null;
  this.siteId = null;
}

MuratcanClient.prototype._fetchWithBackoff = function (url, options) {
  var attempt = 0;
  var delay = CONFIG.HTTP.INITIAL_DELAY_MS;

  while (attempt < CONFIG.HTTP.MAX_RETRIES) {
    try {
      var response = UrlFetchApp.fetch(url, Object.assign({}, options, { muteHttpExceptions: true }));
      var code = response.getResponseCode();

      if (code >= 200 && code < 300) return response;

      var body = response.getContentText() || '';

      if (code === 429 || code >= 500) {
        Telemetry.warn('Retryable HTTP', {
          code: code,
          attempt: attempt + 1,
          body: body.slice(0, 200),
        });
      } else {
        throw new Error('Kritik HTTP Hatası ' + code + ': ' + body);
      }
    } catch (err) {
      if (attempt === CONFIG.HTTP.MAX_RETRIES - 1) throw err;

      Telemetry.warn('Network retry', {
        attempt: attempt + 1,
        error: String(err && err.message ? err.message : err),
      });
    }

    attempt++;
    Utilities.sleep(delay + Math.floor(Math.random() * 500));
    delay *= 2;
  }

  throw new Error('Max retries exceeded: ' + url);
};

MuratcanClient.prototype._isUnauthorized = function (err) {
  var msg = err && err.message ? String(err.message) : String(err || '');

  return msg.indexOf('Kritik HTTP Hatası 401') >= 0 || msg.indexOf('Kritik HTTP Hatasi 401') >= 0;
};

MuratcanClient.prototype.verifyHandshake = function (siteId) {
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

MuratcanClient.prototype._computeHexSignature = function (payload, secret) {
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

MuratcanClient.prototype._fetchWithSessionRetry = function (url, options) {
  try {
    return this._fetchWithBackoff(url, options);
  } catch (err) {
    if (!this.sessionToken || !this.siteId || !this._isUnauthorized(err)) {
      throw err;
    }

    Telemetry.warn('Session expired; renewing handshake', { url: url });

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
      Object.assign({}, options, {
        headers: nextHeaders,
      })
    );
  }
};

/**
 * Fetch OCI export page.
 *
 * markAsExported:
 * - false = peek / no claim
 * - true = sync / claim/export lane
 *
 * @param {string} siteId
 * @param {string|null} cursor
 * @param {boolean|undefined} markAsExported
 */
MuratcanClient.prototype.fetchPage = function (siteId, cursor, markAsExported) {
  var doMark = markAsExported !== false;

  var url =
    this.baseUrl +
    '/api/oci/google-ads-export?siteId=' +
    encodeURIComponent(siteId) +
    '&markAsExported=' +
    (doMark ? 'true' : 'false') +
    '&limit=' +
    encodeURIComponent(String(CONFIG.LIMIT));

  if (cursor) {
    url += '&cursor=' + encodeURIComponent(cursor);
  }

  var allowlist = parseAllowlistIds(CONFIG.ALLOWLIST_IDS);

  if (allowlist && allowlist.size > 0) {
    var csv = Array.from(allowlist).join(',');

    url += '&allowlistIds=' + encodeURIComponent(csv);
    url += '&allowlist_ids=' + encodeURIComponent(csv);
  }

  var response = this._fetchWithSessionRetry(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + this.sessionToken,
      Accept: 'application/json',
      'x-opsmantik-canary-mode': allowlist && allowlist.size > 0 ? 'true' : 'false',
      'x-opsmantik-allowlist-ids': allowlist && allowlist.size > 0 ? Array.from(allowlist).join(',') : '',
      'x-opsmantik-canary-expected-queue-id': CONFIG.CANARY_EXPECTED_QUEUE_ID || '',
      'x-opsmantik-change-ticket': CONFIG.CHANGE_TICKET || '',
      'x-opsmantik-operator-id': CONFIG.OPERATOR_ID || '',
      'x-opsmantik-canary-site-id': CONFIG.CANARY_SITE_ID || siteId,
      'x-opsmantik-canary-max-batch-size': allowlist && allowlist.size > 0 ? '1' : String(CONFIG.LIMIT),
      'x-opsmantik-canary-approval': allowlist && allowlist.size > 0 ? 'I_APPROVE_PRODUCTION_CANARY' : '',
      'x-opsmantik-canary-risk-ack': allowlist && allowlist.size > 0 ? 'I_ACKNOWLEDGE_CANARY_SITE_RISK' : '',
    },
  });

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
    resolvedSiteUuid: payload.siteId || null,
    markAsExported: typeof payload.markAsExported === 'boolean' ? payload.markAsExported : doMark,
    warnings: payload.warnings || null,
    exportRunId: payload.export_run_id || null,
    rawPayloadShape: Array.isArray(payload) ? 'array' : 'object',
  };
};

MuratcanClient.prototype.sendAck = function (siteId, queueIds, skippedIds, failedRows, exportRunId) {
  var q = queueIds || [];
  var s = skippedIds || [];
  var f = failedRows || [];

  if (!q.length && !s.length && !f.length) return null;

  var url = this.baseUrl + '/api/oci/ack';

  var payload = {
    siteId: siteId,
    queueIds: q,
  };

  if (s.length > 0) {
    payload.skippedIds = s;
  }

  var resolvedExportRunId = exportRunId || CONFIG.CANARY_EXPORT_RUN_ID || null;
  if (resolvedExportRunId) {
    payload.exportRunId = resolvedExportRunId;
    payload.export_run_id = resolvedExportRunId;
  }

  if (f.length > 0) {
    payload.results = []
      .concat(
        q.map(function (id) {
          return {
            id: id,
            status: 'SUCCESS',
          };
        })
      )
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

  var payloadStr = JSON.stringify(payload);

  var response = this._fetchWithSessionRetry(url, {
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
    return { ok: false, parse_error: true };
  }
};

MuratcanClient.prototype.sendAckFailed = function (siteId, queueIds, errorCode, errorMessage, errorCategory, exportRunId) {
  if (!queueIds || !queueIds.length) return null;

  var url = this.baseUrl + '/api/oci/ack-failed';

  var resolvedExportRunId = exportRunId || CONFIG.CANARY_EXPORT_RUN_ID || null;
  var payload = JSON.stringify({
    siteId: siteId,
    queueIds: queueIds,
    errorCode: errorCode || 'UNKNOWN',
    errorMessage: errorMessage || errorCode || 'UNKNOWN',
    errorCategory: errorCategory || 'TRANSIENT',
    exportRunId: resolvedExportRunId || undefined,
    export_run_id: resolvedExportRunId || undefined,
  });

  var response = this._fetchWithSessionRetry(url, {
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
    return { ok: false, parse_error: true };
  }
};

MuratcanClient.prototype.sendSummary = function (summaryPayload) {
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

    var response = this._fetchWithSessionRetry(url, {
      method: 'post',
      headers: headers,
      payload: payloadStr,
    });

    return JSON.parse(response.getContentText() || '{}');
  } catch (err) {
    Telemetry.warn('sendSummary failed optional', err);
    return { ok: false };
  }
};

function processPageUpload(rows, opts) {
  var timezone = AdsApp.currentAccount().getTimeZone() || 'Europe/Istanbul';

  var upload = AdsApp.bulkUploads().newCsvUpload(
    [
      'Order ID',
      'Google Click ID',
      'Conversion name',
      'Conversion time',
      'Conversion value',
      'Conversion currency',
    ],
    {
      moneyInMicros: false,
      timeZone: timezone,
    }
  );

  upload.forOfflineConversions();
  upload.setFileName('OpsMantik_MuratcanAku_' + new Date().toISOString() + '.csv');

  var stats = {
    uploaded: 0,
    successIds: [],
    skippedIds: [],
    failedRows: [],
    uploadFailed: false,
    classified_uploadable_count: 0,
    classified_skipped_count: 0,
    classified_failed_count: 0,
  };

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];

    assertCanaryPayload(row);

    var v = Validator.analyze(row);

    if (!v.valid) {
      stats.classified_failed_count++;

      if (row && row.id) {
        stats.failedRows.push({
          queueId: row.id,
          errorCode: v.reason,
          errorMessage: v.reason,
          errorCategory: 'VALIDATION',
        });
      }

      continue;
    }

    var orderIdRaw = row.orderId || row.id || '';
    var orderId = String(orderIdRaw).slice(0, 64);

    if (!orderId) {
      stats.classified_failed_count++;

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

    var conversionValue = normalizeMoney(row.conversionValue);
    var conversionName = String(row.conversionName || '').trim() || CONVERSION_EVENTS.WON;
    var currency = String(row.conversionCurrency || 'TRY').toUpperCase();

    upload.append({
      'Order ID': orderId,
      'Google Click ID': v.clickId,
      'Conversion name': conversionName,
      'Conversion time': Validator.normalizeGoogleAdsTime(row.conversionTime),
      'Conversion value': conversionValue,
      'Conversion currency': currency,
    });

    stats.classified_uploadable_count++;
    stats.uploaded++;

    if (row.id) {
      stats.successIds.push(String(row.id));
    }
  }

  if (stats.uploaded > 0) {
    try {
      Telemetry.info('Google Ads upload.apply başlıyor', {
        uploadedRows: stats.uploaded,
        successIds: stats.successIds,
      });

      upload.apply();

      Telemetry.info('Google Ads upload.apply tamamlandı', {
        uploadedRows: stats.uploaded,
        successIds: stats.successIds,
      });
    } catch (err) {
      stats.uploadFailed = true;

      var msg = err && err.message ? String(err.message).slice(0, 500) : 'UPLOAD_EXCEPTION';

      Telemetry.error('Google Ads upload.apply hata verdi', err);

      if (typeof opts.onUploadFailure === 'function' && stats.successIds.length > 0) {
        opts.onUploadFailure(stats.successIds, 'UPLOAD_EXCEPTION', msg, 'TRANSIENT');
      }
    }
  }

  return stats;
}

function resolveRunMode() {
  var raw =
    typeof OPSMANTIK_RUN_MODE === 'string'
      ? OPSMANTIK_RUN_MODE.trim().toLowerCase()
      : 'sync';

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

function assertSyncCanaryConfig() {
  var allowlist = parseAllowlistIds(CONFIG.ALLOWLIST_IDS);

  if (!CONFIG.SITE_ID || !CONFIG.API_KEY) {
    throw new Error('CONFIG_MISSING_SITE_ID_OR_API_KEY');
  }

  if (!allowlist || allowlist.size !== 1) {
    throw new Error('ALLOWLIST_REQUIRED_EXACTLY_ONE_ID');
  }

  if (!CONFIG.CANARY_EXPECTED_QUEUE_ID || !allowlist.has(CONFIG.CANARY_EXPECTED_QUEUE_ID)) {
    throw new Error('ALLOWLIST_MUST_MATCH_CANARY_EXPECTED_QUEUE_ID');
  }

  if (CONFIG.CANARY_UPLOAD_APPROVAL !== 'I_APPROVE_SINGLE_PAYLOAD_GOOGLE_UPLOAD') {
    throw new Error('CANARY_UPLOAD_APPROVAL_MISSING');
  }

  if (CONFIG.LIMIT !== 1) {
    throw new Error('CANARY_EXPORT_LIMIT_MUST_BE_1');
  }

  if (!CONFIG.CANARY_EXPORT_RUN_ID) {
    throw new Error('CANARY_EXPORT_RUN_ID_REQUIRED');
  }

  return allowlist;
}

/**
 * PEEK mode:
 * - markAsExported=false
 * - no Google upload
 * - no ACK
 */
function mainPeekOciQueue() {
  Telemetry.info('Muratcan Akü — PEEK / OCI kuyruk özeti');
  Telemetry.info(
    'NOT: Bu mod upload yapmaz, ACK atmaz, sadece export payload görünürlüğünü kontrol eder.'
  );

  CONFIG = getScriptConfig();

  if (!CONFIG.SITE_ID || !CONFIG.API_KEY) {
    Telemetry.error(
      'Eksik yapılandırma: OPSMANTIK_SITE_ID ve OPSMANTIK_API_KEY gerekli.',
      null
    );
    return;
  }

  var allowlist = parseAllowlistIds(CONFIG.ALLOWLIST_IDS);

  try {
    var client = new MuratcanClient(CONFIG.BASE_URL, CONFIG.API_KEY);
    client.verifyHandshake(CONFIG.SITE_ID);

    var cursor = null;
    var pageNo = 0;
    var grandTotalRows = 0;
    var foundAllowlistedRows = 0;

    while (true) {
      pageNo++;

      var page = client.fetchPage(CONFIG.SITE_ID, cursor, false);

      Telemetry.info('PEEK export sayfası', {
        page: pageNo,
        resolvedSiteUuid: page.resolvedSiteUuid,
        counts: page.counts,
        markAsExportedServer: page.markAsExported,
        warnings: page.warnings,
        rowsThisPage: (page.items || []).length,
        exportRunId: page.exportRunId,
      });

      var rows = page.items || [];
      grandTotalRows += rows.length;

      if (allowlist && rows.length > 0) {
        rows = rows.filter(function (r) {
          return r && r.id && allowlist.has(String(r.id));
        });

        Telemetry.warn('Peek allowlist filtresi', {
          remainingRows: rows.length,
        });
      }

      foundAllowlistedRows += rows.length;

      var cap = Math.min(rows.length, 20);

      for (var ri = 0; ri < cap; ri++) {
        var rr = rows[ri];

        Logger.log(
          '[OCI_SIRA] id=' +
            (rr && rr.id ? String(rr.id) : '') +
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
            (rr && rr.gbraid ? '1' : '0')
        );
      }

      cursor = page.nextCursor;

      if (!(page.hasNextPage && cursor)) break;
    }

    Telemetry.info('Muratcan Akü PEEK tamam', {
      pageCount: pageNo,
      totalExportRowsSeen: grandTotalRows,
      allowlistedRowsSeen: foundAllowlistedRows,
    });
  } catch (err) {
    Telemetry.error('Muratcan Akü PEEK hatası', err);
    throw err;
  }
}

/**
 * SYNC mode:
 * - markAsExported=true
 * - upload to Google Ads
 * - ACK success ids
 * - ACK_FAILED upload.apply exception ids
 */
function mainSyncMuratcan() {
  Telemetry.info('Muratcan Akü OCI SYNC — tek canary payload upload + ACK');

  CONFIG = getScriptConfig();

  var allowlist = assertSyncCanaryConfig();

  Telemetry.warn('CANARY SYNC guard aktif', {
    allowlistCount: allowlist.size,
    expectedQueueId: CONFIG.CANARY_EXPECTED_QUEUE_ID,
    exportLimit: CONFIG.LIMIT,
    exportRunId: CONFIG.CANARY_EXPORT_RUN_ID,
    changeTicket: CONFIG.CHANGE_TICKET,
    operatorId: CONFIG.OPERATOR_ID,
  });

  try {
    var client = new MuratcanClient(CONFIG.BASE_URL, CONFIG.API_KEY);
    client.verifyHandshake(CONFIG.SITE_ID);

    var cursor = null;
    var totalUploaded = 0;
    var totalAck = 0;
    var pageNo = 0;
    var exportRunId = CONFIG.CANARY_EXPORT_RUN_ID || null;

    var summaryStats = {
      fetched_count: 0,
      claimed_count: 0,
      classified_uploadable_count: 0,
      classified_skipped_count: 0,
      classified_failed_count: 0,
      upload_attempted_count: 0,
      upload_success_count: 0,
      upload_failed_count: 0,
      provider_ambiguous_pending_count: 0,
      ack_success_count: 0,
      ack_failed_count: 0,
      ack_skipped_count: 0,
    };

    var allowlistProcessed = false;
    var allowlistedRowFound = false;

    while (true) {
      pageNo++;

      var page = client.fetchPage(CONFIG.SITE_ID, cursor, true);
      var originalRows = page.items || [];

      if (page.exportRunId && exportRunId && page.exportRunId !== exportRunId) {
        Telemetry.warn('Export run id mismatch warning', {
          pinned: exportRunId,
          fromPage: page.exportRunId,
        });
      }

      if (page.exportRunId && !exportRunId) {
        exportRunId = page.exportRunId;
      }

      summaryStats.fetched_count += originalRows.length;
      summaryStats.claimed_count += originalRows.length;

      if (originalRows.length > 0) {
        var nonAllowlistedRows = originalRows.filter(function (r) {
          return !r || !r.id || !allowlist.has(String(r.id));
        });

        if (nonAllowlistedRows.length > 0) {
          throw new Error('ALLOWLIST_SERVER_RESPONSE_CONTAINED_NON_ALLOWLIST_ROW');
        }
      }

      var rows = originalRows.filter(function (r) {
        return r && r.id && allowlist.has(String(r.id));
      });

      if (rows.length > 1) {
        throw new Error('CANARY_EXPECTED_EXACTLY_ONE_ROW_GOT_' + rows.length);
      }

      if (rows.length === 1) {
        allowlistedRowFound = true;

        assertCanaryPayload(rows[0]);

        try {
          var stats = processPageUpload(rows, {
            onUploadFailure: function (ids, code, msg, cat) {
              var ackFailedRes = client.sendAckFailed(CONFIG.SITE_ID, ids, code, msg, cat, exportRunId);

              Telemetry.warn('ACK_FAILED sent after upload.apply failure', {
                ids: ids,
                result: ackFailedRes,
              });
            },
          });

          summaryStats.classified_uploadable_count += stats.classified_uploadable_count;
          summaryStats.classified_skipped_count += stats.classified_skipped_count;
          summaryStats.classified_failed_count += stats.classified_failed_count;
          summaryStats.upload_attempted_count += stats.classified_uploadable_count;

          if (stats.uploadFailed) {
            summaryStats.upload_failed_count += stats.classified_uploadable_count;
            summaryStats.ack_failed_count += stats.classified_uploadable_count;

            Telemetry.warn('upload.apply hata verdi — ACK gönderilmedi, ACK_FAILED denendi', {
              page: pageNo,
              successIds: stats.successIds,
            });

            cursor = page.nextCursor;
            allowlistProcessed = true;
            break;
          }

          summaryStats.upload_success_count += stats.uploaded;

          if (stats.successIds.length || stats.skippedIds.length || stats.failedRows.length) {
            var ackRes = client.sendAck(
              CONFIG.SITE_ID,
              stats.successIds,
              stats.skippedIds,
              stats.failedRows,
              exportRunId
            );

            Telemetry.info('ACK response', ackRes);

            if (ackRes && typeof ackRes.updated === 'number') {
              totalAck += ackRes.updated;
            }

            summaryStats.ack_success_count += stats.successIds.length;
            summaryStats.ack_skipped_count += stats.skippedIds.length;
            summaryStats.ack_failed_count += stats.failedRows.length;
          }

          totalUploaded += stats.uploaded;

          Telemetry.info('Sayfa sync tamam', {
            page: pageNo,
            fetched: originalRows.length,
            uploaded: stats.uploaded,
            failedRows: stats.failedRows.length,
            countsApi: page.counts,
            exportRunId: page.exportRunId || exportRunId,
          });
        } catch (err) {
          Telemetry.error('Sayfa işleme hatası', err);

          var ids = rows
            .map(function (r) {
              return r && r.id ? String(r.id) : '';
            })
            .filter(function (id) {
              return id.length > 0;
            });

          if (ids.length > 0) {
            var failRes = client.sendAckFailed(
              CONFIG.SITE_ID,
              ids,
              'PAGE_PROCESSING_FAILURE',
              String(err && err.message ? err.message : err).slice(0, 500),
              'TRANSIENT',
              exportRunId
            );

            Telemetry.warn('ACK_FAILED sent after page processing failure', {
              ids: ids,
              result: failRes,
            });

            summaryStats.ack_failed_count += ids.length;
          }

          throw err;
        }

        allowlistProcessed = true;
      }

      cursor = page.nextCursor;

      if (allowlistProcessed) break;
      if (!(page.hasNextPage && cursor)) break;
    }

    if (!allowlistedRowFound) {
      throw new Error('ALLOWLIST_ROW_NOT_FOUND_OR_NOT_EXPORTABLE');
    }

    Telemetry.info('Muratcan Akü SYNC tamamlandı', {
      totalUploaded: totalUploaded,
      totalAckUpdated: totalAck,
      pages: pageNo,
      exportRunId: exportRunId,
    });

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
        provider_ambiguous_pending_count: summaryStats.provider_ambiguous_pending_count,
        ack_success_count: summaryStats.ack_success_count,
        ack_failed_count: summaryStats.ack_failed_count,
        ack_skipped_count: summaryStats.ack_skipped_count,
      };

      var summaryRes = client.sendSummary(summaryPayload);

      Telemetry.info('Sent run summary', {
        ok: summaryRes.ok,
        status: summaryRes.script_summary_status,
        mismatch_reasons: summaryRes.mismatch_reasons,
      });
    } catch (err) {
      Telemetry.warn('Failed to send run summary optional feature', err);
    }
  } catch (err) {
    Telemetry.error('Muratcan Akü SYNC durdu', err);
    throw err;
  }
}

function main() {
  var mode = resolveRunMode();

  if (mode === 'peek') {
    mainPeekOciQueue();
  } else {
    mainSyncMuratcan();
  }
}