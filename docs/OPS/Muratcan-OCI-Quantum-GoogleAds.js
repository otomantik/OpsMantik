/**
 * OCI SYNC ENGINE v3.0 (Quantum Edition) — Muratcan AKÜ
 * Google Ads Script Editor'a yapıştırın. Phone (Enhanced Conversions) dahil.
 * Kaynak: scripts/google-ads-oci/deploy/Muratcan-OCI-Quantum.js
 */
'use strict';
var MURATCAN_SITE_ID = '28cf0aefaa074f5bb29e818a9d53b488';
var MURATCAN_BASE_URL = 'https://console.opsmantik.com';
var MURATCAN_API_KEY = '3a1a48f946a1f42c584dc15975ff95c2cb2cb0ab23beffc79c5bb03b0fb47726';
function getConfig() {
  var props = null;
  try { if (typeof PropertiesService !== 'undefined') props = PropertiesService.getScriptProperties(); } catch (e) {}
  var get = function (key, fallback) {
    if (props && props.getProperty) { var v = props.getProperty(key); if (v) return v; }
    return fallback || '';
  };
  return Object.freeze({
    SITE_ID: get('OPSMANTIK_SITE_ID', MURATCAN_SITE_ID) || '',
    API_KEY: get('OPSMANTIK_API_KEY', MURATCAN_API_KEY) || '',
    BASE_URL: get('OPSMANTIK_BASE_URL', MURATCAN_BASE_URL) || 'https://console.opsmantik.com',
    SAMPLING_RATE_V1: 0.1,
    HTTP: Object.freeze({ MAX_RETRIES: 5, INITIAL_DELAY_MS: 1500, TIMEOUT_MS: 60000 })
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
class Telemetry {
  static info(msg, meta) { Logger.log('[INFO] ' + msg + (meta ? ' | ' + JSON.stringify(meta) : '')); }
  static warn(msg, meta) { Logger.log('[WARN] ' + msg + (meta ? ' | ' + JSON.stringify(meta) : '')); }
  static error(msg, err) { Logger.log('[ERROR] ' + msg + (err ? (err.message || err) : '')); if (err && err.stack) Logger.log('   ' + err.stack); }
  static wtf(msg) { Logger.log('[FATAL] ' + msg); }
}
class Validator {
  static isSampledIn(clickId, rate) {
    if (rate >= 1.0) return true; if (rate <= 0.0) return false;
    var hash = 5381; for (var i = 0; i < clickId.length; i++) hash = ((hash << 5) + hash) + clickId.charCodeAt(i);
    return Math.abs(hash) % 10000 / 10000 <= rate;
  }
  static isValidGoogleAdsTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return false;
    var s = timeStr.trim(); return s.length >= 20 && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{4}$/.test(s);
  }
  static isValidClickId(clickId) {
    if (!clickId || typeof clickId !== 'string') return false;
    var s = clickId.trim(); return s.length >= 10 && s.length <= 256 && /^[A-Za-z0-9_+\/=\-]+$/.test(s);
  }
  static normalizeClickIdForCsv(clickId) {
    if (!clickId || typeof clickId !== 'string') return clickId || '';
    return String(clickId).trim().replace(/\+/g, '-').replace(/\//g, '_');
  }
  static isValidConversionValue(val) {
    if (val == null) return true;
    var n = parseFloat(String(val).replace(/[^\d.-]/g, '')); return !isNaN(n) && n >= 0 && isFinite(n);
  }
  static analyze(row) {
    var clickId = row.gclid || row.wbraid || row.gbraid;
    if (!clickId) return { valid: false, reason: 'MISSING_CLICK_ID' };
    if (!this.isValidClickId(clickId)) return { valid: false, reason: 'INVALID_CLICK_ID_FORMAT' };
    if (!row.conversionTime) return { valid: false, reason: 'MISSING_TIME' };
    if (!this.isValidGoogleAdsTime(row.conversionTime)) return { valid: false, reason: 'INVALID_TIME_FORMAT' };
    if (!this.isValidConversionValue(row.conversionValue)) return { valid: false, reason: 'INVALID_CONVERSION_VALUE' };
    if (row.conversionName === CONVERSION_EVENTS.V1_PAGEVIEW && !this.isSampledIn(clickId, CONFIG.SAMPLING_RATE_V1))
      return { valid: false, reason: 'DETERMINISTIC_SKIP' };
    return { valid: true, clickId: clickId };
  }
}
class QuantumClient {
  constructor(baseUrl, apiKey) { this.baseUrl = baseUrl.replace(/\/+$/, ''); this.apiKey = apiKey; this.sessionToken = null; }
  _fetchWithBackoff(url, options) {
    var attempt = 0, delay = CONFIG.HTTP.INITIAL_DELAY_MS;
    while (attempt < CONFIG.HTTP.MAX_RETRIES) {
      try {
        var response = UrlFetchApp.fetch(url, Object.assign({}, options, { muteHttpExceptions: true }));
        var code = response.getResponseCode();
        if (code >= 200 && code < 300) return response;
        if (code === 429 || code >= 500) { Telemetry.warn('HTTP ' + code + ' retry ' + (attempt + 1)); } else throw new Error('HTTP ' + code + ': ' + response.getContentText());
      } catch (err) { if (attempt === CONFIG.HTTP.MAX_RETRIES - 1) throw err; Telemetry.warn('Ag ' + (attempt + 1) + ': ' + err.message); }
      attempt++; Utilities.sleep(delay + Math.random() * 500); delay *= 2;
    }
    throw new Error('Tum denemeler basarisiz: ' + url);
  }
  verifyHandshake(siteId) {
    var url = this.baseUrl + '/api/oci/v2/verify';
    var response = this._fetchWithBackoff(url, { method: 'post', headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' }, payload: JSON.stringify({ siteId: siteId }) });
    var data = JSON.parse(response.getContentText()); if (!data.session_token) throw new Error('session_token yok'); this.sessionToken = data.session_token;
  }
  fetchConversions(siteId) {
    var url = this.baseUrl + '/api/oci/google-ads-export?siteId=' + encodeURIComponent(siteId) + '&markAsExported=true';
    var response = this._fetchWithBackoff(url, { method: 'get', headers: { 'Authorization': 'Bearer ' + this.sessionToken, 'Accept': 'application/json' } });
    return JSON.parse(response.getContentText() || '[]');
  }
  sendAck(siteId, queueIds, skippedIds, pendingConfirmation) {
    if (!queueIds.length && (!skippedIds || !skippedIds.length)) return null;
    var payload = { siteId: siteId, queueIds: queueIds || [] }; if (skippedIds && skippedIds.length) payload.skippedIds = skippedIds; if (pendingConfirmation) payload.pendingConfirmation = true;
    var response = this._fetchWithBackoff(this.baseUrl + '/api/oci/ack', { method: 'post', headers: { 'Authorization': 'Bearer ' + this.sessionToken, 'Content-Type': 'application/json' }, payload: JSON.stringify(payload) });
    try { return JSON.parse(response.getContentText() || '{}'); } catch (e) { return { ok: false }; }
  }
  sendAckFailed(siteId, queueIds, errorCode, errorMessage, errorCategory) {
    if (!queueIds.length) return;
    this._fetchWithBackoff(this.baseUrl + '/api/oci/ack-failed', { method: 'post', headers: { 'Authorization': 'Bearer ' + this.sessionToken, 'Content-Type': 'application/json' }, payload: JSON.stringify({ siteId: siteId, queueIds: queueIds, errorCode: errorCode || 'VALIDATION_FAILED', errorMessage: errorMessage || errorCode, errorCategory: errorCategory || 'VALIDATION' }) });
  }
}
class UploadEngine {
  constructor() { this.columns = ['Order ID', 'Google Click ID', 'Conversion name', 'Conversion time', 'Conversion value', 'Conversion currency', 'Phone']; }
  process(conversions, opts) {
    var timezone = AdsApp.currentAccount().getTimeZone() || 'Europe/Istanbul';
    var upload = AdsApp.bulkUploads().newCsvUpload(this.columns, { moneyInMicros: false, timeZone: timezone });
    upload.forOfflineConversions(); upload.setFileName('Muratcan_OCI_' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv');
    var stats = { uploaded: 0, skippedDeterministic: 0, skippedValidation: 0, successIds: [], skippedIds: [], failedRows: [], uploadFailed: false };
    for (var i = 0; i < conversions.length; i++) {
      var row = conversions[i], validation = Validator.analyze(row);
      if (!validation.valid) {
        if (validation.reason === 'DETERMINISTIC_SKIP') { stats.skippedDeterministic++; if (row.id) stats.skippedIds.push(row.id); continue; }
        Telemetry.warn('Atlandi: ' + validation.reason, { id: row.id || 'N/A' }); stats.skippedValidation++;
        if (row.id) stats.failedRows.push({ queueId: row.id, errorCode: validation.reason, errorMessage: validation.reason, errorCategory: 'VALIDATION' });
        continue;
      }
      var conversionValue = parseFloat(String(row.conversionValue || 0).replace(/[^\d.-]/g, '')) || 0;
      var orderId = String(row.orderId || row.id || '').substring(0, 64);
      var clickIdForCsv = Validator.normalizeClickIdForCsv(validation.clickId);
      var hashedPhone = (row.hashed_phone_number || row.hashedPhoneNumber || '').trim();
      upload.append({ 'Order ID': orderId, 'Google Click ID': clickIdForCsv, 'Conversion name': (row.conversionName || '').trim() || CONVERSION_EVENTS.V5_SEAL, 'Conversion time': row.conversionTime, 'Conversion value': Math.max(0, conversionValue), 'Conversion currency': (row.conversionCurrency || 'TRY').toUpperCase(), 'Phone': hashedPhone || '' });
      Telemetry.info('Gonderildi: ' + orderId.substring(0, 40) + (orderId.length > 40 ? '...' : '') + (hashedPhone ? ' +Phone(EC)' : ''), { id: row.id || '' });
      stats.uploaded++; if (row.id) stats.successIds.push(row.id);
    }
    if (stats.uploaded > 0) {
      try { upload.apply(); Telemetry.warn('CSV yuklendi. Google Ads > Araclar > Yuklemeler kontrol edin.'); } catch (err) {
        var msg = (err && err.message) ? String(err.message).slice(0, 500) : 'UPLOAD_EXCEPTION';
        Telemetry.error('upload.apply() HATA: ' + msg, err);
        if (opts && typeof opts.onUploadFailure === 'function' && stats.successIds.length) opts.onUploadFailure(stats.successIds, 'UPLOAD_EXCEPTION', msg, 'TRANSIENT');
        return Object.assign({}, stats, { uploadFailed: true });
      }
    }
    return stats;
  }
}
function main() {
  Telemetry.info('Muratcan AKU Quantum OCI baslatiliyor...');
  try {
    if (!CONFIG.SITE_ID || !CONFIG.API_KEY) { Telemetry.wtf('OPSMANTIK_SITE_ID ve OPSMANTIK_API_KEY gerekli.'); return; }
    var client = new QuantumClient(CONFIG.BASE_URL, CONFIG.API_KEY);
    client.verifyHandshake(CONFIG.SITE_ID);
    var conversions = client.fetchConversions(CONFIG.SITE_ID);
    if (!Array.isArray(conversions) || conversions.length === 0) { Telemetry.info('Islenecek donusum yok.'); return; }
    Telemetry.info(conversions.length + ' sinyal. Yukleniyor...');
    var engine = new UploadEngine();
    var stats = engine.process(conversions, { onUploadFailure: function (ids, code, msg, cat) { if (ids && ids.length) client.sendAckFailed(CONFIG.SITE_ID, ids, code, msg, cat); } });
    Telemetry.info('Yuklendi: ' + stats.uploaded + ', Skip: ' + (stats.skippedDeterministic || 0) + ', ValidationFail: ' + stats.skippedValidation);
    if (stats.uploadFailed) return;
    if (stats.successIds.length || (stats.skippedIds && stats.skippedIds.length)) {
      var ackRes = client.sendAck(CONFIG.SITE_ID, stats.successIds, stats.skippedIds || [], true);
      Telemetry.info('ACK: updated=' + (ackRes && ackRes.updated != null ? ackRes.updated : 'N/A'));
    }
    if (stats.failedRows && stats.failedRows.length) {
      var byErr = {}; for (var j = 0; j < stats.failedRows.length; j++) { var f = stats.failedRows[j]; var k = f.errorCode; if (!byErr[k]) byErr[k] = { queueIds: [], errorCode: f.errorCode, errorMessage: f.errorMessage, errorCategory: f.errorCategory }; byErr[k].queueIds.push(f.queueId); }
      for (var k in byErr) if (byErr.hasOwnProperty(k)) { var g = byErr[k]; client.sendAckFailed(CONFIG.SITE_ID, g.queueIds, g.errorCode, g.errorMessage, g.errorCategory); }
    }
    Telemetry.info('Muratcan OCI tamamlandi.');
  } catch (error) { Telemetry.wtf('Hata.'); Telemetry.error('', error); }
}
