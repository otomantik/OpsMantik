/**
 * OCI SYNC ENGINE v3.0 (Quantum Edition) — Eslamed
 * Site: Eslamed (eslamed.com)
 * V8 Engine Native | Deterministic Sampling | Auto-Healing
 * Kurulum: Google Ads Script Editor'a yapıştır. Script Properties veya aşağıdaki Eslamed değerleri.
 * API key: node scripts/get-eslamed-credentials.mjs
 */

'use strict';

// ========================================================================
// ESLAMED DEFAULTS (Script Properties öncelikli)
// ========================================================================
var ESLAMED_SITE_ID = '81d957f3c7534f53b12ff305f9f07ae7';   // Eslamed public_id
var ESLAMED_BASE_URL = 'https://console.opsmantik.com';
var ESLAMED_API_KEY = 'becaef33f722de5f08691091bbe2cbb7fba0594e56ccbfb4c8a15b3ebedd2cf1';   // Eslamed sites.oci_api_key

// ========================================================================
// ENV CONFIGURATION (ScriptProperties or Eslamed fallbacks)
// ========================================================================
function getConfig() {
  var props = null;
  try {
    if (typeof PropertiesService !== 'undefined') {
      props = PropertiesService.getScriptProperties();
    }
  } catch (e) { /* ignore */ }
  var get = function (key, fallback) {
    if (props) {
      var v = props.getProperty && props.getProperty(key);
      if (v) return v;
    }
    if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key];
    return fallback || '';
  };
  var isLocal = typeof require !== 'undefined' && require.main && require.main === module;
  return Object.freeze({
    SITE_ID: get('OPSMANTIK_SITE_ID', ESLAMED_SITE_ID) || (isLocal ? 'mock-site-id' : ''),
    API_KEY: get('OPSMANTIK_API_KEY', ESLAMED_API_KEY) || (isLocal ? 'mock-api-key' : ''),
    BASE_URL: get('OPSMANTIK_BASE_URL', ESLAMED_BASE_URL) || 'https://console.opsmantik.com',
    SAMPLING_RATE_V1: 0.1,
    HTTP: Object.freeze({
      MAX_RETRIES: 5,
      INITIAL_DELAY_MS: 1500,
      TIMEOUT_MS: 60000,
    }),
  });
}
var CONFIG = getConfig();

var CONVERSION_EVENTS = Object.freeze({
  V1_PAGEVIEW: 'OpsMantik_V1_Nabiz',
  V2_PULSE: 'OpsMantik_V2_Ilk_Temas',
  V3_ENGAGE: 'OpsMantik_V3_Nitelikli_Gorusme',
  V4_INTENT: 'OpsMantik_V4_Sicak_Teklif',
  V5_SEAL: 'OpsMantik_V5_DEMIR_MUHUR',
});

// ========================================================================
// TELEMETRY SYSTEM
// ========================================================================
class Telemetry {
  static info(msg, meta) { meta = meta || ''; Logger.log('[INFO] ' + msg + (meta ? ' | ' + JSON.stringify(meta) : '')); }
  static warn(msg, meta) { meta = meta || ''; Logger.log('[WARN] ' + msg + (meta ? ' | ' + JSON.stringify(meta) : '')); }
  static error(msg, err) {
    Logger.log('[ERROR] ' + msg + ' | ' + (err ? (err.message || err) : ''));
    if (err && err.stack) Logger.log('   Stack: ' + err.stack);
  }
  static wtf(msg) { Logger.log('[FATAL] ' + msg); }
}

// ========================================================================
// DETERMINISTIC ENGINE & VALIDATORS
// ========================================================================
class Validator {
  static isSampledIn(clickId, rate) {
    if (rate >= 1.0) return true;
    if (rate <= 0.0) return false;
    var hash = 5381;
    for (var i = 0; i < clickId.length; i++) {
      hash = ((hash << 5) + hash) + clickId.charCodeAt(i);
    }
    var normalized = Math.abs(hash) % 10000 / 10000;
    return normalized <= rate;
  }

  /** Google requires: yyyy-mm-dd HH:mm:ss+|-HH:mm (timezone mandatory). */
  static isValidGoogleAdsTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return false;
    var s = timeStr.trim();
    if (s.length < 20) return false;
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(s);
  }

  /** GCLID/WBRAID/GBRAID: alphanumeric, reasonable length (prevent obviously broken IDs). */
  static isValidClickId(clickId) {
    if (!clickId || typeof clickId !== 'string') return false;
    var s = clickId.trim();
    if (s.length < 10 || s.length > 256) return false;
    return /^[A-Za-z0-9_-]+$/.test(s);
  }

  /** Conversion value: non-negative number. */
  static isValidConversionValue(val) {
    if (val == null) return true;
    var n = parseFloat(String(val).replace(/[^\d.-]/g, ''));
    return !isNaN(n) && n >= 0 && isFinite(n);
  }

  static analyze(row) {
    var clickId = row.gclid || row.wbraid || row.gbraid;
    if (!clickId) return { valid: false, reason: 'MISSING_CLICK_ID' };
    if (!this.isValidClickId(clickId)) return { valid: false, reason: 'INVALID_CLICK_ID_FORMAT' };

    if (!row.conversionTime) return { valid: false, reason: 'MISSING_TIME' };
    if (!this.isValidGoogleAdsTime(row.conversionTime)) return { valid: false, reason: 'INVALID_TIME_FORMAT' };

    if (!this.isValidConversionValue(row.conversionValue)) return { valid: false, reason: 'INVALID_CONVERSION_VALUE' };

    if (row.conversionName === CONVERSION_EVENTS.V1_PAGEVIEW) {
      if (!this.isSampledIn(clickId, CONFIG.SAMPLING_RATE_V1)) {
        return { valid: false, reason: 'DETERMINISTIC_SKIP' };
      }
    }

    return { valid: true, clickId: clickId };
  }
}

// ========================================================================
// QUANTUM NETWORK LAYER (Auto-Healing HTTP)
// ========================================================================
class QuantumClient {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.sessionToken = null;
  }

  _fetchWithBackoff(url, options) {
    var attempt = 0;
    var delay = CONFIG.HTTP.INITIAL_DELAY_MS;

    while (attempt < CONFIG.HTTP.MAX_RETRIES) {
      try {
        var response = UrlFetchApp.fetch(url, Object.assign({}, options, { muteHttpExceptions: true }));
        var code = response.getResponseCode();

        if (code >= 200 && code < 300) return response;

        if (code === 429 || code >= 500) {
          var body = response.getContentText();
          Telemetry.warn('HTTP ' + code + ' on attempt ' + (attempt + 1) + '. Retrying...', { url: url, body: (body || '').substring(0, 100) });
        } else {
          throw new Error('Kritik HTTP Hatasi ' + code + ': ' + response.getContentText());
        }
      } catch (err) {
        if (attempt === CONFIG.HTTP.MAX_RETRIES - 1) throw err;
        Telemetry.warn('Ag Hatasi (Deneme ' + (attempt + 1) + '): ' + err.message);
      }

      attempt++;
      var jitter = Math.random() * 500;
      Utilities.sleep(delay + jitter);
      delay *= 2;
    }
    throw new Error('Butun ' + CONFIG.HTTP.MAX_RETRIES + ' ag denemesi basarisiz: ' + url);
  }

  verifyHandshake(siteId) {
    var url = this.baseUrl + '/api/oci/v2/verify';
    var response = this._fetchWithBackoff(url, {
      method: 'post',
      headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ siteId: siteId })
    });

    var data = JSON.parse(response.getContentText());
    if (!data.session_token) throw new Error('Beklenmeyen Yanit: session_token eksik.');
    this.sessionToken = data.session_token;
  }

  fetchConversions(siteId) {
    var url = this.baseUrl + '/api/oci/google-ads-export?siteId=' + encodeURIComponent(siteId) + '&markAsExported=true';
    var response = this._fetchWithBackoff(url, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + this.sessionToken,
        'Accept': 'application/json'
      }
    });

    return JSON.parse(response.getContentText() || '[]');
  }

  sendAck(siteId, queueIds, skippedIds, pendingConfirmation) {
    if (!queueIds.length && (!skippedIds || !skippedIds.length)) return null;
    var url = this.baseUrl + '/api/oci/ack';
    var payload = { siteId: siteId, queueIds: queueIds || [] };
    if (skippedIds && skippedIds.length > 0) payload.skippedIds = skippedIds;
    if (pendingConfirmation === true) payload.pendingConfirmation = true;
    var response = this._fetchWithBackoff(url, {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + this.sessionToken,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload)
    });
    try {
      return JSON.parse(response.getContentText() || '{}');
    } catch (e) {
      return { ok: false, raw: response.getContentText ? response.getContentText() : '' };
    }
  }

  sendAckFailed(siteId, queueIds, errorCode, errorMessage, errorCategory) {
    if (!queueIds.length) return;
    var url = this.baseUrl + '/api/oci/ack-failed';
    this._fetchWithBackoff(url, {
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

// ========================================================================
// GOOGLE ADS UPLOAD ENGINE
// ========================================================================
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
    var timezone = AdsApp.currentAccount().getTimeZone() || 'Europe/Istanbul';
    var upload = AdsApp.bulkUploads().newCsvUpload(this.columns, {
      moneyInMicros: false,
      timeZone: timezone
    });
    upload.forOfflineConversions();
    upload.setFileName('Eslamed_OCI_' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv');

    var stats = {
      uploaded: 0,
      skippedDeterministic: 0,
      skippedValidation: 0,
      successIds: [],
      skippedIds: [],
      failedRows: [],
      uploadFailed: false,
    };

    for (var i = 0; i < conversions.length; i++) {
      var row = conversions[i];
      var validation = Validator.analyze(row);

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

      var conversionValue = parseFloat(String(row.conversionValue || 0).replace(/[^\d.-]/g, '')) || 0;

      var orderIdRaw = row.orderId || row.id || '';
      var orderId = String(orderIdRaw).substring(0, 64);  // Google Ads Order ID max 64 karakter
      var gclidShort = (validation.clickId || '').substring(0, 20) + ((validation.clickId || '').length > 20 ? '...' : '');
      upload.append({
        'Order ID': orderId,
        'Google Click ID': validation.clickId,
        'Conversion name': (row.conversionName || '').trim() || CONVERSION_EVENTS.V5_SEAL,
        'Conversion time': row.conversionTime,
        'Conversion value': Math.max(0, conversionValue),
        'Conversion currency': (row.conversionCurrency || 'TRY').toUpperCase()
      });
      Telemetry.info('Gonderildi: orderId=' + (orderId.length > 50 ? orderId.substring(0, 50) + '...' : orderId) + ' gclid=' + gclidShort, { id: row.id || '' });

      stats.uploaded++;
      if (row.id) stats.successIds.push(row.id);
    }

    if (stats.uploaded > 0) {
      try {
        upload.apply();
        Telemetry.warn('CSV uploaded successfully to Google Ads. Awaiting Google internal processing. Row-level API errors cannot be fetched via Scripts. Check Google Ads UI > Tools > Uploads for actual conversion import errors.');
      } catch (err) {
        var msg = (err && err.message) ? String(err.message).slice(0, 500) : 'UPLOAD_EXCEPTION';
        Telemetry.error('upload.apply() HATA: ' + msg, err);
        if (typeof opts !== 'undefined' && opts !== null && typeof opts.onUploadFailure === 'function' && stats.successIds.length > 0) {
          opts.onUploadFailure(stats.successIds, 'UPLOAD_EXCEPTION', msg, 'TRANSIENT');
        }
        return Object.assign({}, stats, { uploadFailed: true });
      }
    }

    return stats;
  }
}

// ========================================================================
// MAIN EXECUTION — Eslamed OCI Sync
// ========================================================================
function main() {
  Telemetry.info('Eslamed Quantum OCI Engine Baslatiliyor...');
  var ackUpdated = null;

  try {
    if (!CONFIG.SITE_ID || !CONFIG.API_KEY) {
      Telemetry.wtf('API_KEY gerekli. Script Properties: OPSMANTIK_SITE_ID, OPSMANTIK_API_KEY. Key: node scripts/get-eslamed-credentials.mjs');
      return;
    }

    var client = new QuantumClient(CONFIG.BASE_URL, CONFIG.API_KEY);

    Telemetry.info('Ag protokolu dogrulaniyor...');
    client.verifyHandshake(CONFIG.SITE_ID);

    Telemetry.info('Kuyruk dinleniyor...');
    var conversions = client.fetchConversions(CONFIG.SITE_ID);

    if (!Array.isArray(conversions) || conversions.length === 0) {
      Telemetry.info('Islenecek yeni donusum bulunamadi. Uyku moduna geciliyor.');
      return;
    }

    Telemetry.info(conversions.length + ' ham sinyal yakalandi. Validasyon basliyor...');

    var engine = new UploadEngine();
    var stats = engine.process(conversions, {
      onUploadFailure: function (ids, errorCode, errorMessage, errorCategory) {
        if (ids && ids.length > 0) {
          Telemetry.warn('Upload apply failed; marking appended rows FAILED (TRANSIENT)', { count: ids.length });
          client.sendAckFailed(CONFIG.SITE_ID, ids, errorCode, errorMessage, errorCategory);
        }
      }
    });

    Telemetry.info('Yukleme Bilancosu: Yuklendi: ' + stats.uploaded + ', Deterministic Skip: ' + (stats.skippedDeterministic || 0) + ', Validation Fail: ' + stats.skippedValidation);

    if (stats.uploadFailed) return;

    if (stats.successIds.length > 0 || (stats.skippedIds && stats.skippedIds.length > 0)) {
      var total = (stats.successIds.length || 0) + (stats.skippedIds && stats.skippedIds.length || 0);
      Telemetry.info(total + ' kayit icin API\'ye Muhur (ACK) gonderiliyor (pendingConfirmation=true: UPLOADED)...');
      var ackRes = client.sendAck(CONFIG.SITE_ID, stats.successIds, stats.skippedIds, true);
      if (ackRes) {
        ackUpdated = ackRes.updated != null ? ackRes.updated : null;
        Telemetry.info('ACK geri donus: ok=' + !!ackRes.ok + ', updated=' + (ackRes.updated || 0) + (ackRes.warnings ? ' | uyari=' + JSON.stringify(ackRes.warnings) : ''));
        Telemetry.info('Google\'a giden -> offline_conversion_queue UPLOADED (pending Google processing): ' + (stats.successIds.join(', ') || '-'));
        Telemetry.info('DETERMINISTIC_SKIP (V1 sampled) -> COMPLETED: ' + ((stats.skippedIds || []).join(', ') || '-'));
      }
    }

    if (stats.failedRows && stats.failedRows.length > 0) {
      var byError = {};
      for (var j = 0; j < stats.failedRows.length; j++) {
        var f = stats.failedRows[j];
        var key = f.errorCode + '|' + f.errorCategory;
        if (!byError[key]) byError[key] = { queueIds: [], errorCode: f.errorCode, errorMessage: f.errorMessage, errorCategory: f.errorCategory };
        byError[key].queueIds.push(f.queueId);
      }
      for (var k in byError) {
        if (byError.hasOwnProperty(k)) {
          var g = byError[k];
          Telemetry.info(g.queueIds.length + ' kayit FAILED isaretleniyor: ' + g.errorCode);
          client.sendAckFailed(CONFIG.SITE_ID, g.queueIds, g.errorCode, g.errorMessage, g.errorCategory);
        }
      }
    }

    if (stats.successIds.length > 0 || (stats.skippedIds && stats.skippedIds.length > 0) || (stats.failedRows && stats.failedRows.length > 0)) {
      Telemetry.info('Eslamed OCI senkronizasyonu tamamlandi.');
      Telemetry.info('=== RAPOR === Ham: ' + (conversions ? conversions.length : 0) + ' | Yuklendi: ' + stats.uploaded + ' | Skip: ' + (stats.skippedDeterministic || 0) + ' | ValidationFail: ' + stats.skippedValidation + ' | Google ID: ' + (stats.successIds.join(', ') || '-') + ' | ACK updated: ' + (ackUpdated != null ? ackUpdated : 'N/A') + ' ===');
    }

  } catch (error) {
    Telemetry.wtf('Script kritik bir cekirdek hatasiyla durduruldu.');
    Telemetry.error('Iz Dokumu', error);
  }
}

// ========================================================================
// LOCAL TESTING (node Eslamed-OCI-Quantum.js)
// ========================================================================
if (typeof module !== 'undefined' && require !== 'undefined' && require.main === module) {
  console.log('[LOCAL] Eslamed OCI Quantum - Local Mode');

  global.Logger = { log: function (msg) { console.log(msg); } };
  global.Utilities = { sleep: function (ms) { var w = new Date(new Date().getTime() + ms); while (w > new Date()) {} } };
  global.UrlFetchApp = {
    fetch: function (url, options) {
      console.log('\n[Mock] ' + (options.method || 'GET').toUpperCase() + ' ' + url);
      return {
        getResponseCode: function () { return 200; },
        getContentText: function () {
          if (url.indexOf('/api/oci/v2/verify') !== -1) return JSON.stringify({ session_token: 'mock_eslamed_token' });
          if (url.indexOf('/api/oci/google-ads-export') !== -1) return JSON.stringify([
            { id: 'mock-1', gclid: 'TEST_GCLID', conversionName: 'OpsMantik_V5_DEMIR_MUHUR', conversionTime: '2026-03-01 15:30:00+03:00', conversionValue: 5000, conversionCurrency: 'TRY' }
          ]);
          if (url.indexOf('/api/oci/ack') !== -1) return JSON.stringify({ updated: 1 });
          if (url.indexOf('/api/oci/ack-failed') !== -1) return JSON.stringify({ ok: true });
          return '{}';
        }
      };
    }
  };
  global.AdsApp = {
    currentAccount: function () { return { getTimeZone: function () { return 'Europe/Istanbul'; } }; },
    bulkUploads: function () {
      return {
        newCsvUpload: function (cols, cfg) {
          return {
            forOfflineConversions: function () {},
            setFileName: function (n) { console.log('[Mock] File: ' + n); },
            append: function (r) { console.log('[Mock] Row:', r); },
            apply: function () { console.log('[Mock] Upload OK'); }
          };
        }
      };
    }
  };

  console.log('--------------------------------------------------');
  main();
  console.log('--------------------------------------------------');
  console.log('[LOCAL] Bitti.');
}
