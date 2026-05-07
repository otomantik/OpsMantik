/**
 * OpsMantik Google Ads OCI - Koc Oto Kurtarma script.
 *
 * Paste into Google Ads Script Editor. Entry point: `main`.
 * Use Script Properties for credentials:
 * - OPSMANTIK_SITE_ID
 * - OPSMANTIK_API_KEY
 * - OPSMANTIK_BASE_URL (optional, defaults to console.opsmantik.com)
 *
 * Run modes:
 * - "peek": queue preview only, no upload/ack
 * - "sync": upload + ack/ack-failed flow
 */

'use strict';

/** @type {string} peek | sync */
var OPSMANTIK_RUN_MODE = 'sync';

/** @type {string} sites.public_id or internal UUID - leave empty, use Script Properties */
var OPSMANTIK_INLINE_SITE_ID = '';

/** @type {string} sites.oci_api_key - leave empty, use Script Properties */
var OPSMANTIK_INLINE_API_KEY = '';

/** @type {string} default https://console.opsmantik.com */
var OPSMANTIK_INLINE_BASE_URL = '';

/** @type {string} empty -> 200; max 1000 */
var OPSMANTIK_INLINE_EXPORT_LIMIT = '';

/** @type {string} optional comma allowlist queue/signal ids */
var OPSMANTIK_INLINE_ALLOWLIST_IDS = '';

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
      key === 'OPSMANTIK_ALLOWLIST_IDS' &&
      typeof OPSMANTIK_INLINE_ALLOWLIST_IDS === 'string' &&
      OPSMANTIK_INLINE_ALLOWLIST_IDS.trim()
    ) {
      return OPSMANTIK_INLINE_ALLOWLIST_IDS.trim();
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

  const isLocal = typeof require !== 'undefined' && require.main && require.main === module;

  return Object.freeze({
    SITE_ID: getFirst(['OPSMANTIK_SITE_ID', 'OCI_SITE_ID'], '') || (isLocal ? 'mock-public-id' : ''),
    API_KEY: getFirst(['OPSMANTIK_API_KEY', 'OCI_API_KEY'], '') || (isLocal ? 'mock-key' : ''),
    BASE_URL: getFirst(['OPSMANTIK_BASE_URL', 'OCI_BASE_URL'], '') || 'https://console.opsmantik.com',
    ALLOWLIST_IDS: getFirst(['OPSMANTIK_ALLOWLIST_IDS'], ''),
    LIMIT: limit,
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

/** SSOT literals - lib/domain/mizan-mantik/conversion-names.ts */
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

  analyze: function (row) {
    const gclid = row.gclid ? String(row.gclid).trim() : '';
    const hasBraid = Boolean((row.wbraid && String(row.wbraid).trim()) || (row.gbraid && String(row.gbraid).trim()));
    if (!gclid) {
      if (hasBraid) return { valid: false, reason: 'UNSUPPORTED_CLICK_ID_FOR_ADS_SCRIPT' };
      return { valid: false, reason: 'MISSING_CLICK_ID' };
    }
    if (!row.conversionTime) return { valid: false, reason: 'MISSING_TIME' };
    if (!this.isValidGoogleAdsTime(row.conversionTime)) return { valid: false, reason: 'INVALID_TIME_FORMAT' };
    return { valid: true, clickId: gclid };
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

/** @param markAsExported {boolean|undefined} default true */
KocOtoClient.prototype.fetchPage = function (siteId, cursor, markAsExported) {
  var doMark = markAsExported !== false;
  let url =
    this.baseUrl +
    '/api/oci/google-ads-export?siteId=' +
    encodeURIComponent(siteId) +
    '&markAsExported=' +
    (doMark ? 'true' : 'false') +
    '&limit=' +
    encodeURIComponent(String(CONFIG.LIMIT));
  if (cursor) url += '&cursor=' + encodeURIComponent(cursor);

  let response;
  try {
    response = this._fetchWithSessionRetry(url, {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + this.sessionToken,
        Accept: 'application/json',
      },
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
  if (!queueIds || !queueIds.length) return;
  const url = this.baseUrl + '/api/oci/ack-failed';
  const payload = JSON.stringify({
    siteId: siteId,
    queueIds: queueIds,
    errorCode: errorCode || 'UNKNOWN',
    errorMessage: errorMessage || errorCode,
    errorCategory: errorCategory || 'TRANSIENT',
  });
  this._fetchWithSessionRetry(url, {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + this.sessionToken,
      'Content-Type': 'application/json',
      'x-oci-signature': this._computeHexSignature(payload, this.apiKey),
    },
  });
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
  const timezone = AdsApp.currentAccount().getTimeZone() || 'Europe/Istanbul';
  const upload = AdsApp.bulkUploads().newCsvUpload(
    ['Order ID', 'Google Click ID', 'Conversion name', 'Conversion time', 'Conversion value', 'Conversion currency'],
    { moneyInMicros: false, timeZone: timezone }
  );
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
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const v = Validator.analyze(row);
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

    const orderIdRaw = row.orderId || row.id || '';
    const orderId = String(orderIdRaw).slice(0, 64);
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

    stats.classified_uploadable_count++;

    const conversionValue = Math.max(0, parseFloat(String(row.conversionValue || 0).replace(/[^\d.-]/g, '')) || 0);
    const conversionName = (row.conversionName || '').trim() || CONVERSION_EVENTS.WON;
    const currency = (row.conversionCurrency || 'TRY').toUpperCase();

    upload.append({
      'Order ID': orderId,
      'Google Click ID': v.clickId,
      'Conversion name': conversionName,
      'Conversion time': Validator.normalizeGoogleAdsTime(row.conversionTime),
      'Conversion value': conversionValue,
      'Conversion currency': currency,
    });

    stats.uploaded++;
    if (row.id) stats.successIds.push(row.id);
  }

  if (stats.uploaded > 0) {
    try {
      upload.apply();
    } catch (err) {
      stats.uploadFailed = true;
      const msg = err && err.message ? String(err.message).slice(0, 500) : 'UPLOAD_EXCEPTION';
      if (typeof opts.onUploadFailure === 'function' && stats.successIds.length > 0) {
        opts.onUploadFailure(stats.successIds, 'UPLOAD_EXCEPTION', msg, 'TRANSIENT');
      }
    }
  }

  return stats;
}

function resolveRunMode() {
  const raw =
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

/** Show OCI queue without uploading (markAsExported=false). */
function mainPeekOciQueue() {
  Telemetry.info('Koc Oto Kurtarma - PEEK / OCI queue summary');
  Telemetry.info(
    'NOTE: Intent cards are not shown here; this log summarizes journal rows from offline_conversion_queue only.'
  );

  CONFIG = getScriptConfig();

  if (!CONFIG.SITE_ID || !CONFIG.API_KEY) {
    Telemetry.error(
      'Eksik yapÄ±landÄ±rma: INLINE OPSMANTIK_INLINE_SITE_ID ve OPSMANTIK_INLINE_API_KEY veya Script Properties.',
      null
    );
    return;
  }

  const allowlist = parseAllowlistIds(CONFIG.ALLOWLIST_IDS);

  try {
    const client = new KocOtoClient(CONFIG.BASE_URL, CONFIG.API_KEY);
    client.verifyHandshake(CONFIG.SITE_ID);

    let cursor = null;
    let pageNo = 0;
    let grandTotalRows = 0;

    while (true) {
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

      let rows = page.items || [];
      grandTotalRows += rows.length;

      if (allowlist && rows.length > 0) {
        rows = rows.filter(function (r) {
          return r && r.id && allowlist.has(String(r.id));
        });
        Telemetry.warn('Peek allowlist filtresi', { kalanSatir: rows.length });
      }

      var cap = Math.min(rows.length, 60);
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

      if (cap < rows.length) {
        Telemetry.info('Peek row summary truncated', {
          yazilanBuSayfa: cap,
          toplamBuSayfa: rows.length,
        });
      }

      cursor = page.nextCursor;
      if (!(page.hasNextPage && cursor)) break;
    }

    Telemetry.info('Koc Oto Kurtarma PEEK completed', { pageCount: pageNo, totalRows: grandTotalRows });
  } catch (err) {
    Telemetry.error('Koc Oto Kurtarma PEEK error', err);
    throw err;
  }
}

function mainSyncKocOto() {
  Telemetry.info('Koc Oto Kurtarma OCI SYNC - upload + ACK');

  CONFIG = getScriptConfig();

  if (!CONFIG.SITE_ID || !CONFIG.API_KEY) {
    Telemetry.error('Eksik yapÄ±landÄ±rma: OPSMANTIK_SITE_ID ve OPSMANTIK_API_KEY (INLINE veya Script Properties).', null);
    return;
  }

  const allowlist = parseAllowlistIds(CONFIG.ALLOWLIST_IDS);
  if (allowlist) {
    Telemetry.warn('ALLOWLIST aktif', { count: allowlist.size });
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
      ack_skipped_count: 0
    };

    while (true) {
      pageNo++;
      const page = client.fetchPage(CONFIG.SITE_ID, cursor, true);
      let rows = page.items || [];
      
      if (page.exportRunId && !exportRunId) {
        exportRunId = page.exportRunId;
      }
      
      summaryStats.fetched_count += rows.length;
      summaryStats.claimed_count += rows.length;

      if (allowlist && rows.length > 0) {
        rows = rows.filter(function (r) {
          return r && r.id && allowlist.has(String(r.id));
        });
      }

      if (rows.length > 0) {
        try {
          const stats = processPageUpload(rows, {
            onUploadFailure: function (ids, code, msg, cat) {
              client.sendAckFailed(CONFIG.SITE_ID, ids, code, msg, cat);
            },
          });

          if (stats.uploadFailed) {
            summaryStats.classified_uploadable_count += stats.classified_uploadable_count;
            summaryStats.classified_skipped_count += stats.classified_skipped_count;
            summaryStats.classified_failed_count += stats.classified_failed_count;
            summaryStats.upload_attempted_count += stats.classified_uploadable_count;
            summaryStats.upload_failed_count += stats.classified_uploadable_count;
            summaryStats.ack_failed_count += stats.classified_uploadable_count;

            Telemetry.warn('upload.apply failed - ack-failed sent; skipping ACK for this page', { page: pageNo });
            cursor = page.nextCursor;
            if (!(page.hasNextPage && cursor)) break;
            continue;
          }

          summaryStats.classified_uploadable_count += stats.classified_uploadable_count;
          summaryStats.classified_skipped_count += stats.classified_skipped_count;
          summaryStats.classified_failed_count += stats.classified_failed_count;
          summaryStats.upload_attempted_count += stats.classified_uploadable_count;
          summaryStats.upload_success_count += stats.uploaded;

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
            countsApi: page.counts,
          });
        } catch (err) {
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
              String(err && err.message ? err.message : err).slice(0, 500),
              'TRANSIENT'
            );
          }
          throw err;
        }
      }

      cursor = page.nextCursor;
      if (!(page.hasNextPage && cursor)) break;
    }

    Telemetry.info('Koc Oto Kurtarma SYNC completed', { totalUploaded: totalUploaded, pages: pageNo });
    
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
        ack_skipped_count: summaryStats.ack_skipped_count
      };
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

