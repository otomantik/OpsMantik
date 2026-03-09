/**
 * SNAPSHOT ONLY
 * Source of truth: scripts/google-ads-oci/GoogleAdsScript.js
 * SECURITY: Prefer Script Properties over inline fallback values.
 *
 * ========================================================================
 * OPSMANTIK QUANTUM ENGINE (V15.0) - Google Ads Offline Conversion Importer
 * Client: Eslamed (eslamed.com)
 * ========================================================================
 *
 * Script-only bulk upload path:
 * - Uses AdsApp.bulkUploads().newCsvUpload(...).forOfflineConversions()
 * - Compatible with mixed V1/V2/V3/V4/V5 export payloads
 * - ACK/NACK contract matches OpsMantik OCI export
 */

'use strict';

function getConfig() {
  let props = null;
  try {
    if (typeof PropertiesService !== 'undefined') {
      props = PropertiesService.getScriptProperties();
    }
  } catch (e) { /* ignore */ }

  const FALLBACKS = Object.freeze({
    SITE_ID: '81d957f3c7534f53b12ff305f9f07ae7',
    API_KEY: 'becaef33f722de5f08691091bbe2cbb7fba0594e56ccbfb4c8a15b3ebedd2cf1',
    BASE_URL: 'https://console.opsmantik.com'
  });

  const getFirst = function (keys, fallback) {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (props) {
        const v = props.getProperty && props.getProperty(key);
        if (v) return v;
      }
      if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key];
    }
    return fallback || '';
  };

  return Object.freeze({
    SITE_ID: getFirst(['OPSMANTIK_SITE_ID', 'OCI_SITE_ID'], FALLBACKS.SITE_ID),
    API_KEY: getFirst(['OPSMANTIK_API_KEY', 'OCI_API_KEY'], FALLBACKS.API_KEY),
    BASE_URL: getFirst(['OPSMANTIK_BASE_URL', 'OCI_BASE_URL'], FALLBACKS.BASE_URL),
    SAMPLING_RATE_V1: Number(getFirst(['OPSMANTIK_SAMPLING_RATE_V1', 'OCI_SAMPLING_RATE_V1'], '0.1')) || 0.1,
    HTTP: Object.freeze({
      MAX_RETRIES: 5,
      INITIAL_DELAY_MS: 1500,
      TIMEOUT_MS: 60000,
    }),
  });
}
const CONFIG = getConfig();

const CONVERSION_EVENTS = Object.freeze({
  V1_PAGEVIEW: 'OpsMantik_V1_Nabiz',
  V2_PULSE: 'OpsMantik_V2_Ilk_Temas',
  V3_ENGAGE: 'OpsMantik_V3_Nitelikli_Gorusme',
  V4_INTENT: 'OpsMantik_V4_Sicak_Teklif',
  V5_SEAL: 'OpsMantik_V5_DEMIR_MUHUR',
});

class Telemetry {
  static info(msg, meta) { Logger.log('[INFO] ' + msg + (meta ? ' | ' + JSON.stringify(meta) : '')); }
  static warn(msg, meta) { Logger.log('[WARN] ' + msg + (meta ? ' | ' + JSON.stringify(meta) : '')); }
  static error(msg, err) {
    Logger.log('[ERROR] ' + msg + ' | ' + (err ? (err.message || err) : ''));
    if (err && err.stack) Logger.log('   Stack: ' + err.stack);
  }
  static wtf(msg) { Logger.log('[FATAL] ' + msg); }
}

class Validator {
  static isSampledIn(clickId, rate) {
    if (rate >= 1.0) return true;
    if (rate <= 0.0) return false;

    let hash = 5381;
    for (let i = 0; i < clickId.length; i++) {
      hash = ((hash << 5) + hash) + clickId.charCodeAt(i);
    }
    const normalized = Math.abs(hash) % 10000 / 10000;
    return normalized <= rate;
  }

  static isValidGoogleAdsTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return false;
    const s = timeStr.trim();
    if (/^\d{8} \d{6}$/.test(s)) return true;
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:?\d{2}$/.test(s);
  }

  static normalizeGoogleAdsTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return '';
    const s = timeStr.trim();
    if (/^\d{8} \d{6}$/.test(s)) return s;
    return s.replace(/([+-]\d{2}):(\d{2})$/, '$1$2');
  }

  static analyze(row) {
    const clickId = row.gclid || row.wbraid || row.gbraid;
    if (!clickId) return { valid: false, reason: 'MISSING_CLICK_ID' };

    if (!row.conversionTime) return { valid: false, reason: 'MISSING_TIME' };
    if (!this.isValidGoogleAdsTime(row.conversionTime)) return { valid: false, reason: 'INVALID_TIME_FORMAT' };

    if (row.conversionName === CONVERSION_EVENTS.V1_PAGEVIEW) {
      if (!this.isSampledIn(clickId, CONFIG.SAMPLING_RATE_V1)) {
        return { valid: false, reason: 'DETERMINISTIC_SKIP' };
      }
    }

    return { valid: true, clickId: clickId };
  }
}

class QuantumClient {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.sessionToken = null;
    this.siteId = null;
  }

  _fetchWithBackoff(url, options) {
    let attempt = 0;
    let delay = CONFIG.HTTP.INITIAL_DELAY_MS;

    while (attempt < CONFIG.HTTP.MAX_RETRIES) {
      try {
        const response = UrlFetchApp.fetch(url, Object.assign({}, options, { muteHttpExceptions: true }));
        const code = response.getResponseCode();

        if (code >= 200 && code < 300) return response;

        if (code === 429 || code >= 500) {
          const body = response.getContentText();
          Telemetry.warn('HTTP ' + code + ' on attempt ' + (attempt + 1) + '. Retrying...', {
            url: url,
            body: body.substring(0, 100)
          });
        } else {
          throw new Error('Kritik HTTP Hatasi ' + code + ': ' + response.getContentText());
        }
      } catch (err) {
        if (attempt === CONFIG.HTTP.MAX_RETRIES - 1) throw err;
        Telemetry.warn('Ag Hatasi (Deneme ' + (attempt + 1) + '): ' + err.message);
      }

      attempt++;
      const jitter = Math.random() * 500;
      Utilities.sleep(delay + jitter);
      delay *= 2;
    }

    throw new Error('Butun ' + CONFIG.HTTP.MAX_RETRIES + ' ag denemesi basarisiz oldu: ' + url);
  }

  verifyHandshake(siteId) {
    this.siteId = siteId;
    const url = this.baseUrl + '/api/oci/v2/verify';
    const response = this._fetchWithBackoff(url, {
      method: 'post',
      headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ siteId: siteId })
    });

    const data = JSON.parse(response.getContentText());
    if (!data.session_token) throw new Error('Beklenmeyen Yanit: session_token eksik.');
    this.sessionToken = data.session_token;
  }

  _isUnauthorized(err) {
    const msg = err && err.message ? String(err.message) : String(err || '');
    return msg.indexOf('Kritik HTTP Hatasi 401') >= 0 || msg.indexOf('Kritik HTTP Hatası 401') >= 0;
  }

  _fetchWithSessionRetry(url, options) {
    try {
      return this._fetchWithBackoff(url, options);
    } catch (err) {
      if (!this.sessionToken || !this.siteId || !this._isUnauthorized(err)) throw err;
      Telemetry.warn('Session token expired, handshake yenileniyor...', { url: url });
      this.verifyHandshake(this.siteId);
      const headers = Object.assign({}, options && options.headers ? options.headers : {});
      if (headers.Authorization) headers.Authorization = 'Bearer ' + this.sessionToken;
      return this._fetchWithBackoff(url, Object.assign({}, options, { headers: headers }));
    }
  }

  fetchConversionsPage(siteId, cursor) {
    let url = this.baseUrl + '/api/oci/google-ads-export?siteId=' + encodeURIComponent(siteId) + '&markAsExported=true';
    if (cursor) url += '&cursor=' + encodeURIComponent(cursor);

    const response = this._fetchWithSessionRetry(url, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + this.sessionToken,
        'Accept': 'application/json'
      }
    });

    const payload = JSON.parse(response.getContentText() || '{}');
    if (Array.isArray(payload)) {
      return { items: payload, nextCursor: null };
    }

    return {
      items: Array.isArray(payload.items) ? payload.items : [],
      nextCursor: payload.next_cursor || null
    };
  }

  fetchConversions(siteId) {
    let cursor = null;
    const items = [];
    do {
      const page = this.fetchConversionsPage(siteId, cursor);
      if (page.items && page.items.length > 0) {
        Array.prototype.push.apply(items, page.items);
      }
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }

  sendAck(siteId, queueIds, skippedIds) {
    if (!queueIds.length && (!skippedIds || !skippedIds.length)) return null;
    const url = this.baseUrl + '/api/oci/ack';
    const payload = { siteId: siteId, queueIds: queueIds || [] };
    if (skippedIds && skippedIds.length > 0) payload.skippedIds = skippedIds;

    const response = this._fetchWithSessionRetry(url, {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + this.sessionToken,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload)
    });

    try {
      return JSON.parse(response.getContentText() || '{}');
    } catch (_e) {
      return { ok: false, raw: response.getContentText ? response.getContentText() : '' };
    }
  }

  sendAckFailed(siteId, queueIds, errorCode, errorMessage, errorCategory) {
    if (!queueIds.length) return;
    const url = this.baseUrl + '/api/oci/ack-failed';
    this._fetchWithSessionRetry(url, {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + this.sessionToken,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        siteId: siteId,
        queueIds: queueIds,
        errorCode: errorCode || 'VALIDATION_FAILED',
        errorMessage: errorMessage || errorCode,
        errorCategory: errorCategory || 'VALIDATION'
      })
    });
  }
}

class UploadEngine {
  constructor() {
    this.columns = [
      'Order ID',
      'Google Click ID',
      'Conversion name',
      'Conversion time',
      'Conversion value',
      'Conversion currency'
    ];
  }

  process(conversions, opts) {
    const timezone = AdsApp.currentAccount().getTimeZone() || 'Europe/Istanbul';
    const upload = AdsApp.bulkUploads().newCsvUpload(this.columns, {
      moneyInMicros: false,
      timeZone: timezone
    });
    upload.forOfflineConversions();
    upload.setFileName('Eslamed_OCI_Quantum_' + new Date().toISOString() + '.csv');

    const stats = {
      uploaded: 0,
      skippedDeterministic: 0,
      skippedValidation: 0,
      successIds: [],
      skippedIds: [],
      failedRows: [],
      uploadFailed: false
    };

    for (let i = 0; i < conversions.length; i++) {
      const row = conversions[i];
      const validation = Validator.analyze(row);

      if (!validation.valid) {
        if (validation.reason === 'DETERMINISTIC_SKIP') {
          stats.skippedDeterministic++;
          if (row.id) stats.skippedIds.push(row.id);
          continue;
        }

        Telemetry.warn('Hatali Satir Atlandi: ' + validation.reason, { id: row.id || 'N/A' });
        stats.skippedValidation++;
        if (row.id) {
          stats.failedRows.push({
            queueId: row.id,
            errorCode: validation.reason,
            errorMessage: validation.reason,
            errorCategory: 'VALIDATION'
          });
        }
        continue;
      }

      const conversionValue = parseFloat(String(row.conversionValue || 0).replace(/[^\d.-]/g, '')) || 0;
      const orderIdRaw = row.orderId || row.id || '';
      const orderId = String(orderIdRaw).substring(0, 64);

      upload.append({
        'Order ID': orderId,
        'Google Click ID': validation.clickId,
        'Conversion name': (row.conversionName || '').trim() || CONVERSION_EVENTS.V5_SEAL,
        'Conversion time': Validator.normalizeGoogleAdsTime(row.conversionTime),
        'Conversion value': Math.max(0, conversionValue),
        'Conversion currency': (row.conversionCurrency || 'TRY').toUpperCase()
      });

      stats.uploaded++;
      if (row.id) stats.successIds.push(row.id);
    }

    if (stats.uploaded > 0) {
      try {
        upload.apply();
      } catch (err) {
        if (typeof opts?.onUploadFailure === 'function' && stats.successIds.length > 0) {
          const msg = (err && err.message) ? String(err.message).slice(0, 500) : 'UPLOAD_EXCEPTION';
          opts.onUploadFailure(stats.successIds, 'UPLOAD_EXCEPTION', msg, 'TRANSIENT');
        }
        return Object.assign({}, stats, { uploadFailed: true });
      }
    }

    return stats;
  }
}

function main() {
  Telemetry.info('Eslamed Quantum OCI Engine Baslatiliyor...');

  try {
    const client = new QuantumClient(CONFIG.BASE_URL, CONFIG.API_KEY);

    Telemetry.info('Ag protokolu dogrulaniyor...');
    client.verifyHandshake(CONFIG.SITE_ID);

    Telemetry.info('Kuyruk dinleniyor...');
    const conversions = client.fetchConversions(CONFIG.SITE_ID);

    if (!Array.isArray(conversions) || conversions.length === 0) {
      Telemetry.info('Islenecek yeni donusum bulunamadi. Uyku moduna geciliyor.');
      return;
    }

    Telemetry.info(String(conversions.length) + ' ham sinyal yakalandi. Validasyon basliyor...');

    const engine = new UploadEngine();
    const stats = engine.process(conversions, {
      onUploadFailure: function (ids, errorCode, errorMessage, errorCategory) {
        if (ids && ids.length > 0) {
          Telemetry.warn('Upload apply failed; marking appended rows FAILED (TRANSIENT)', { count: ids.length });
          client.sendAckFailed(CONFIG.SITE_ID, ids, errorCode, errorMessage, errorCategory);
        }
      }
    });

    Telemetry.info(
      'Yukleme Bilancosu: Yuklendi: ' + stats.uploaded +
      ', Deterministic Skip: ' + (stats.skippedDeterministic || 0) +
      ', Validation Fail: ' + (stats.skippedValidation || 0)
    );

    if (stats.uploadFailed) return;

    if (stats.successIds.length > 0 || (stats.skippedIds && stats.skippedIds.length > 0)) {
      const total = (stats.successIds.length || 0) + ((stats.skippedIds && stats.skippedIds.length) || 0);
      Telemetry.info(String(total) + ' kayit icin API\'ye Muhur (ACK) gonderiliyor...');
      const ackRes = client.sendAck(CONFIG.SITE_ID, stats.successIds, stats.skippedIds);
      if (ackRes) {
        Telemetry.info(
          'ACK geri donus: ok=' + (!!ackRes.ok) +
          ', updated=' + (ackRes.updated != null ? ackRes.updated : 0) +
          (ackRes.warnings ? ' | uyari=' + JSON.stringify(ackRes.warnings) : '')
        );
      }
    }

    if (stats.failedRows && stats.failedRows.length > 0) {
      const byError = {};
      for (let i = 0; i < stats.failedRows.length; i++) {
        const f = stats.failedRows[i];
        const key = f.errorCode + '|' + f.errorCategory;
        if (!byError[key]) {
          byError[key] = {
            queueIds: [],
            errorCode: f.errorCode,
            errorMessage: f.errorMessage,
            errorCategory: f.errorCategory
          };
        }
        byError[key].queueIds.push(f.queueId);
      }
      const keys = Object.keys(byError);
      for (let i = 0; i < keys.length; i++) {
        const g = byError[keys[i]];
        Telemetry.info(String(g.queueIds.length) + ' kayit FAILED isaretleniyor: ' + g.errorCode);
        client.sendAckFailed(CONFIG.SITE_ID, g.queueIds, g.errorCode, g.errorMessage, g.errorCategory);
      }
    }

    if (
      stats.successIds.length > 0 ||
      (stats.skippedIds && stats.skippedIds.length > 0) ||
      (stats.failedRows && stats.failedRows.length > 0)
    ) {
      Telemetry.info('Senkronizasyon tamamlandi.');
    }
  } catch (error) {
    Telemetry.wtf('Script kritik bir cekirdek hatasiyla durduruldu.');
    Telemetry.error('Iz Dokumu', error);
  }
}
