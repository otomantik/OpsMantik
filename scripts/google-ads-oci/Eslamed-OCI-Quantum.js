/**
 * OPSMANTIK OCI SYNC — Eslamed Quantum Edition
 * Site: Eslamed (eslamed.com)
 * Kurulum: Google Ads Script Editor'a yapıştır. API_KEY'i aşağıda veya Script Properties'te ayarla.
 *
 * Dönüşüm Adları: OpsMantik_V1_Nabiz, OpsMantik_V2_Ilk_Temas, OpsMantik_V3_Nitelikli_Gorusme,
 *   OpsMantik_V4_Sicak_Teklif, OpsMantik_V5_DEMIR_MUHUR
 */

'use strict';

// ========================================================================
// ESLAMED AYARLARI — Hazır, sadece API_KEY gerekli
// API key: OpsMantik Console > Site > OCI veya: node scripts/get-eslamed-credentials.mjs
// ========================================================================
var ESLAMED_SITE_ID = '81d957f3c7534f53b12ff305f9f07ae7';   // Eslamed public_id
var ESLAMED_BASE_URL = 'https://console.opsmantik.com';
var ESLAMED_API_KEY = 'becaef33f722de5f08691091bbe2cbb7fba0594e56ccbfb4c8a15b3ebedd2cf1';   // Eslamed sites.oci_api_key

// ========================================================================
// CONFIG (Script Properties öncelikli; yoksa yukarıdaki Eslamed değerleri)
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
const CONFIG = getConfig();

const CONVERSION_EVENTS = Object.freeze({
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
  static info(msg, meta = '') { Logger.log(`[INFO] ${msg} ${meta ? `| ${JSON.stringify(meta)}` : ''}`); }
  static warn(msg, meta = '') { Logger.log(`[WARN] ${msg} ${meta ? `| ${JSON.stringify(meta)}` : ''}`); }
  static error(msg, err = null) {
    Logger.log(`[ERROR] ${msg} | ${err ? (err.message || err) : ''}`);
    if (err && err.stack) Logger.log(`   Stack: ${err.stack}`);
  }
  static wtf(msg) { Logger.log(`[FATAL] ${msg}`); }
}

// ========================================================================
// DETERMINISTIC ENGINE & VALIDATORS
// ========================================================================
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
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(timeStr);
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
    return { valid: true, clickId };
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
    let attempt = 0;
    let delay = CONFIG.HTTP.INITIAL_DELAY_MS;
    while (attempt < CONFIG.HTTP.MAX_RETRIES) {
      try {
        const response = UrlFetchApp.fetch(url, { ...options, muteHttpExceptions: true });
        const code = response.getResponseCode();
        if (code >= 200 && code < 300) return response;
        if (code === 429 || code >= 500) {
          Telemetry.warn(`HTTP ${code} on attempt ${attempt + 1}. Retrying...`, { url });
        } else {
          throw new Error(`Kritik HTTP Hatasi ${code}: ${response.getContentText()}`);
        }
      } catch (err) {
        if (attempt === CONFIG.HTTP.MAX_RETRIES - 1) throw err;
        Telemetry.warn(`Ag Hatasi (Deneme ${attempt + 1}): ${err.message}`);
      }
      attempt++;
      const jitter = Math.random() * 500;
      Utilities.sleep(delay + jitter);
      delay *= 2;
    }
    throw new Error(`Butun ${CONFIG.HTTP.MAX_RETRIES} ag denemesi basarisiz: ${url}`);
  }

  verifyHandshake(siteId) {
    const url = `${this.baseUrl}/api/oci/v2/verify`;
    const response = this._fetchWithBackoff(url, {
      method: 'post',
      headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ siteId })
    });
    const data = JSON.parse(response.getContentText());
    if (!data.session_token) throw new Error("Beklenmeyen Yanit: session_token eksik.");
    this.sessionToken = data.session_token;
  }

  fetchConversions(siteId) {
    const url = `${this.baseUrl}/api/oci/google-ads-export?siteId=${encodeURIComponent(siteId)}&markAsExported=true`;
    const response = this._fetchWithBackoff(url, {
      method: 'get',
      headers: { 'Authorization': `Bearer ${this.sessionToken}`, 'Accept': 'application/json' }
    });
    return JSON.parse(response.getContentText() || '[]');
  }

  sendAck(siteId, queueIds, skippedIds) {
    if (!queueIds.length && (!skippedIds || !skippedIds.length)) return;
    const url = `${this.baseUrl}/api/oci/ack`;
    const payload = { siteId, queueIds: queueIds || [] };
    if (skippedIds && skippedIds.length > 0) payload.skippedIds = skippedIds;
    this._fetchWithBackoff(url, {
      method: 'post',
      headers: { 'Authorization': `Bearer ${this.sessionToken}`, 'Content-Type': 'application/json' },
      payload: JSON.stringify(payload)
    });
  }

  sendAckFailed(siteId, queueIds, errorCode, errorMessage, errorCategory) {
    if (!queueIds.length) return;
    const url = `${this.baseUrl}/api/oci/ack-failed`;
    this._fetchWithBackoff(url, {
      method: 'post',
      headers: { 'Authorization': `Bearer ${this.sessionToken}`, 'Content-Type': 'application/json' },
      payload: JSON.stringify({
        siteId, queueIds,
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
    this.columns = ['Order ID', 'Google Click ID', 'Conversion name', 'Conversion time', 'Conversion value', 'Conversion currency'];
  }

  process(conversions, opts) {
    const timezone = AdsApp.currentAccount().getTimeZone() || 'Europe/Istanbul';
    const upload = AdsApp.bulkUploads().newCsvUpload(this.columns, { moneyInMicros: false, timeZone: timezone });
    upload.forOfflineConversions();
    upload.setFileName(`Eslamed_OCI_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);

    const stats = { uploaded: 0, skippedDeterministic: 0, skippedValidation: 0, successIds: [], skippedIds: [], failedRows: [], uploadFailed: false };

    for (const row of conversions) {
      const validation = Validator.analyze(row);
      if (!validation.valid) {
        if (validation.reason === 'DETERMINISTIC_SKIP') {
          stats.skippedDeterministic++;
          if (row.id) stats.skippedIds.push(row.id);
          continue;
        }
        Telemetry.warn(`Hatali Satir: ${validation.reason}`, { id: row.id || 'N/A' });
        stats.skippedValidation++;
        if (row.id) stats.failedRows.push({ queueId: row.id, errorCode: validation.reason, errorMessage: validation.reason, errorCategory: 'VALIDATION' });
        continue;
      }

      const conversionValue = parseFloat(String(row.conversionValue || 0).replace(/[^\d.-]/g, '')) || 0;
      upload.append({
        'Order ID': row.orderId || row.id || '',
        'Google Click ID': validation.clickId,
        'Conversion name': (row.conversionName || '').trim() || CONVERSION_EVENTS.V5_SEAL,
        'Conversion time': row.conversionTime,
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

// ========================================================================
// MAIN EXECUTION — Eslamed OCI Sync
// ========================================================================
function main() {
  Telemetry.info('Eslamed OCI Engine baslatiliyor...');

  try {
    if (!CONFIG.SITE_ID || !CONFIG.API_KEY) {
      Telemetry.wtf('API_KEY gerekli. Ya ESLAMED_API_KEY degiskenine yapistir ya da Script Properties: OPSMANTIK_API_KEY. Key: node scripts/get-eslamed-credentials.mjs');
      return;
    }

    const client = new QuantumClient(CONFIG.BASE_URL, CONFIG.API_KEY);
    client.verifyHandshake(CONFIG.SITE_ID);

    const conversions = client.fetchConversions(CONFIG.SITE_ID);
    if (!Array.isArray(conversions) || conversions.length === 0) {
      Telemetry.info('Islenecek yeni donusum yok.');
      return;
    }

    Telemetry.info(`${conversions.length} ham sinyal alindi. Validasyon basliyor...`);

    const engine = new UploadEngine();
    const stats = engine.process(conversions, {
      onUploadFailure: function (ids, errorCode, errorMessage, errorCategory) {
        if (ids && ids.length > 0) {
          Telemetry.warn('Upload apply failed; appended rows FAILED (TRANSIENT)', { count: ids.length });
          client.sendAckFailed(CONFIG.SITE_ID, ids, errorCode, errorMessage, errorCategory);
        }
      }
    });

    Telemetry.info(`Bilancosu: Yuklendi=${stats.uploaded}, Deterministic Skip=${stats.skippedDeterministic || 0}, Validation Fail=${stats.skippedValidation || 0}`);

    if (stats.uploadFailed) return;

    if (stats.successIds.length > 0 || (stats.skippedIds && stats.skippedIds.length > 0)) {
      const total = (stats.successIds.length || 0) + (stats.skippedIds && stats.skippedIds.length || 0);
      Telemetry.info(`${total} kayit icin ACK gonderiliyor...`);
      client.sendAck(CONFIG.SITE_ID, stats.successIds, stats.skippedIds);
    }

    if (stats.failedRows && stats.failedRows.length > 0) {
      const byError = {};
      for (const f of stats.failedRows) {
        const key = f.errorCode + '|' + f.errorCategory;
        if (!byError[key]) byError[key] = { queueIds: [], errorCode: f.errorCode, errorMessage: f.errorMessage, errorCategory: f.errorCategory };
        byError[key].queueIds.push(f.queueId);
      }
      for (const key of Object.keys(byError)) {
        const g = byError[key];
        Telemetry.info(`${g.queueIds.length} kayit FAILED: ${g.errorCode}`);
        client.sendAckFailed(CONFIG.SITE_ID, g.queueIds, g.errorCode, g.errorMessage, g.errorCategory);
      }
    }

    Telemetry.info('Eslamed OCI senkronizasyonu tamamlandi.');

  } catch (error) {
    Telemetry.wtf('Script kritik hatayla durdu.');
    Telemetry.error('Iz Dokumu', error);
  }
}
