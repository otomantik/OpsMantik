/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  OPSMANTIK — Google Ads Offline Conversion Sync                             ║
 * ║  Iron Seal Identity Protocol | Session Token Handshake                      ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║  INSTALLATION (Google Ads → Tools → Bulk actions → Scripts):                 ║
 * ║    1. Create new script.                                                     ║
 * ║    2. PASTE THIS SCRIPT.                                                     ║
 * ║    3. EDIT THE CONFIG BLOCK BELOW — replace REPLACE_WITH_* with your values. ║
 * ║    4. Set main() as trigger (e.g. every hour).                               ║
 * ║                                                                              ║
 * ║  ⚠️  Use public_id only. UUIDs are forbidden.                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

'use strict';

// ========================================================================
// ⚙️ OPSMANTIK CONFIGURATION (MUST FILL THESE OUT)
// ========================================================================
var OPSMANTIK_SITE_ID = '28cf0aefaa074f5bb29e818a9d53b488';   // Muratcan AKÜ (public_id)
var OPSMANTIK_API_KEY = '3a1a48f946a1f42c584dc15975ff95c2cb2cb0ab23beffc79c5bb03b0fb47726';
var OPSMANTIK_BASE_URL = 'https://console.opsmantik.com';
// ========================================================================

// ---------------------------------------------------------------------------
// LogManager — Enterprise prefixed logging
// ---------------------------------------------------------------------------

var LogManager = (function () {
  var PREFIX = '[OpsMantik OCI]';
  var LEVELS = { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', FATAL: 'FATAL' };

  function _log(level, msg) {
    Logger.log(PREFIX + ' [' + level + '] ' + msg);
  }

  return {
    info: function (msg) { _log(LEVELS.INFO, msg); },
    warn: function (msg) { _log(LEVELS.WARN, msg); },
    error: function (msg) { _log(LEVELS.ERROR, msg); },
    fatal: function (msg) { _log(LEVELS.FATAL, msg); }
  };
})();

// ---------------------------------------------------------------------------
// ConfigLoader — Validates top-level config variables
// ---------------------------------------------------------------------------

/**
 * Load and validate configuration from top-level variables.
 * @returns {{ siteId: string, apiKey: string, baseUrl: string } | null} Config or null if invalid
 */
function ConfigLoader_load() {
  var siteId = (OPSMANTIK_SITE_ID || '').trim();
  var apiKey = (OPSMANTIK_API_KEY || '').trim();
  var baseUrl = (OPSMANTIK_BASE_URL || 'https://console.opsmantik.com').trim().replace(/\/+$/, '');

  if (siteId === 'REPLACE_WITH_YOUR_PUBLIC_ID' || !siteId || !apiKey || apiKey === 'REPLACE_WITH_YOUR_API_KEY') {
    throw new Error('You must replace the configuration variables at the top of the script!');
  }

  var uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(siteId)) {
    LogManager.fatal('You are using an internal UUID. Please use the public_id provided in your OpsMantik Dashboard.');
    LogManager.info('UUIDs are forbidden by the Identity Protocol.');
    return null;
  }

  return { siteId: siteId, apiKey: apiKey, baseUrl: baseUrl };
}

// ---------------------------------------------------------------------------
// AuthManager — Handshake: POST /api/oci/v2/verify → session_token
// ---------------------------------------------------------------------------

/**
 * Perform handshake to obtain session token.
 * @param {{ siteId: string, apiKey: string, baseUrl: string }} config
 * @returns {string | null} session_token or null on failure
 */
function AuthManager_handshake(config) {
  var url = config.baseUrl + '/api/oci/v2/verify';
  var payload = JSON.stringify({ siteId: config.siteId });
  var headers = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey
  };

  try {
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      muteHttpExceptions: true,
      contentType: 'application/json',
      headers: headers,
      payload: payload
    });
  } catch (e) {
    LogManager.error('Handshake fetch error: ' + e.toString());
    return null;
  }

  var code = resp.getResponseCode();
  var body = resp.getContentText();

  if (code === 400) {
    try {
      var json = JSON.parse(body || '{}');
      if (json.code === 'IDENTITY_BOUNDARY') {
        LogManager.fatal('You are using an internal UUID. Please use the public_id provided in your OpsMantik Dashboard.');
        return null;
      }
    } catch (e) { /* ignore */ }
    LogManager.error('Handshake bad request: ' + body);
    return null;
  }

  if (code === 401 || code === 403) {
    LogManager.fatal('Handshake failed: Invalid API key or site configuration. Check OPSMANTIK_SITE_ID and OPSMANTIK_API_KEY.');
    return null;
  }

  if (code !== 200) {
    LogManager.error('Handshake failed: HTTP ' + code + ' ' + body);
    return null;
  }

  try {
    var data = JSON.parse(body);
    if (data.session_token) {
      return data.session_token;
    }
  } catch (e) {
    LogManager.error('Handshake parse error: ' + e.toString());
    return null;
  }

  LogManager.error('Handshake: No session_token in response.');
  return null;
}

// ---------------------------------------------------------------------------
// ExportManager — GET /api/oci/google-ads-export with Bearer token
// ---------------------------------------------------------------------------

/**
 * Fetch conversions from OpsMantik export API.
 * @param {{ siteId: string, baseUrl: string }} config
 * @param {string} sessionToken
 * @returns {Array<Object> | null} Conversions array or null on failure
 */
function ExportManager_fetch(config, sessionToken) {
  var url = config.baseUrl + '/api/oci/google-ads-export?siteId=' + encodeURIComponent(config.siteId) + '&markAsExported=true';
  var headers = {
    'Accept': 'application/json',
    'Authorization': 'Bearer ' + sessionToken
  };

  try {
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      headers: headers
    });
  } catch (e) {
    LogManager.error('Export fetch error: ' + e.toString());
    return null;
  }

  var code = resp.getResponseCode();
  var body = resp.getContentText();

  if (code !== 200) {
    LogManager.error('Export failed: HTTP ' + code + ' ' + body);
    return null;
  }

  try {
    var data = JSON.parse(body);
    if (Array.isArray(data)) return data;
    LogManager.error('Export: response is not an array.');
    return null;
  } catch (e) {
    LogManager.error('Export parse error: ' + e.toString());
    return null;
  }
}

// ---------------------------------------------------------------------------
// GoogleAdsUploader — AdsApp CSV upload
// ---------------------------------------------------------------------------

var COLUMNS = [
  'Order ID',
  'Google Click ID',
  'Conversion name',
  'Conversion time',
  'Conversion value',
  'Conversion currency'
];

/**
 * Build upload rows and apply to Google Ads.
 * @param {Array<Object>} conversions
 * @returns {{ appended: number, skipped: number, uploadedIds: Array<string> }}
 */
function GoogleAdsUploader_apply(conversions) {
  var upload = AdsApp.bulkUploads().newCsvUpload(COLUMNS, {
    moneyInMicros: false,
    timeZone: 'Europe/Istanbul'
  });
  upload.forOfflineConversions();
  upload.setFileName('OpsMantik_OCI_' + new Date().getTime() + '.csv');

  var appended = 0;
  var skipped = 0;
  var uploadedIds = [];

  for (var i = 0; i < conversions.length; i++) {
    var row = conversions[i];
    var gclid = (row.gclid || '').toString().trim();
    var wbraid = (row.wbraid || '').toString().trim();
    var gbraid = (row.gbraid || '').toString().trim();
    var clickId = gclid || wbraid || gbraid;

    if (!clickId) {
      LogManager.warn('Skip row (no click id): id=' + (row.id || i));
      skipped++;
      continue;
    }

    var conversionName = (row.conversionName != null) ? String(row.conversionName) : 'Sealed Lead';
    var conversionTime = (row.conversionTime != null) ? String(row.conversionTime) : '';
    var conversionValue = parseFloat(String(row.conversionValue || 0).replace(/[^\d.-]/g, '')) || 0;
    if (!Number.isFinite(conversionValue) || conversionValue < 0) conversionValue = 0;
    var conversionCurrency = (row.conversionCurrency != null) ? String(row.conversionCurrency).trim().toUpperCase() : 'TRY';
    if (!/^[A-Z]{3}$/.test(conversionCurrency)) conversionCurrency = 'TRY';

    if (!conversionTime) {
      LogManager.warn('Skip row (no conversion time): id=' + (row.id || i));
      skipped++;
      continue;
    }

    var orderId = (row.orderId != null) ? String(row.orderId) : (row.id != null) ? String(row.id) : '';
    upload.append({
      'Order ID': orderId,
      'Google Click ID': clickId,
      'Conversion name': conversionName,
      'Conversion time': conversionTime,
      'Conversion value': conversionValue,
      'Conversion currency': conversionCurrency
    });
    appended++;
    if (row.id) uploadedIds.push(String(row.id));
  }

  if (appended > 0) {
    try {
      upload.apply();
    } catch (e) {
      LogManager.error('AdsApp.upload.apply() error: ' + e.toString());
      throw e;
    }
  }

  return { appended: appended, skipped: skipped, uploadedIds: uploadedIds };
}

// ---------------------------------------------------------------------------
// AckManager — POST /api/oci/ack
// ---------------------------------------------------------------------------

/**
 * Send acknowledgment for uploaded conversions.
 * @param {{ siteId: string, baseUrl: string }} config
 * @param {string} sessionToken
 * @param {Array<string>} queueIds
 * @returns {boolean} true if ACK succeeded
 */
function AckManager_send(config, sessionToken, queueIds) {
  if (!queueIds || queueIds.length === 0) return true;

  var url = config.baseUrl + '/api/oci/ack';
  var payload = JSON.stringify({ siteId: config.siteId, queueIds: queueIds });
  var headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + sessionToken
  };

  var maxRetries = 3;
  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      var resp = UrlFetchApp.fetch(url, {
        method: 'post',
        muteHttpExceptions: true,
        contentType: 'application/json',
        headers: headers,
        payload: payload
      });
      var code = resp.getResponseCode();
      var body = resp.getContentText();

      if (code === 200) {
        LogManager.info('ACK success (updated: ' + (JSON.parse(body || '{}').updated || '?') + ')');
        return true;
      }

      LogManager.warn('ACK failed (attempt ' + attempt + '/' + maxRetries + '): HTTP ' + code);
      if (attempt < maxRetries && code >= 500) {
        Utilities.sleep(2000);
      } else {
        break;
      }
    } catch (e) {
      LogManager.error('ACK error (attempt ' + attempt + '): ' + e.toString());
      if (attempt < maxRetries) Utilities.sleep(2000);
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// main — Entry point
// ---------------------------------------------------------------------------

/**
 * Main entry point. Orchestrates: Config → Handshake → Export → Upload → ACK.
 */
function main() {
  LogManager.info('Starting OCI sync...');

  var config;
  try {
    config = ConfigLoader_load();
  } catch (e) {
    LogManager.fatal(e.toString());
    return;
  }
  if (!config) {
    LogManager.fatal('Configuration invalid. Halting.');
    return;
  }

  var sessionToken = AuthManager_handshake(config);
  if (!sessionToken) {
    LogManager.fatal('Handshake failed. Halting.');
    return;
  }
  LogManager.info('Handshake OK.');

  var conversions = ExportManager_fetch(config, sessionToken);
  if (conversions === null) {
    LogManager.fatal('Export failed. Halting.');
    return;
  }

  LogManager.info('Export returned ' + conversions.length + ' record(s).');

  if (conversions.length === 0) {
    LogManager.info('No conversions to upload.');
    return;
  }

  var result = GoogleAdsUploader_apply(conversions);

  if (result.appended === 0) {
    LogManager.warn('No valid rows to upload (skipped: ' + result.skipped + ').');
    return;
  }

  LogManager.info('Applied ' + result.appended + ' conversions; skipped ' + result.skipped);

  if (result.uploadedIds.length > 0) {
    var ackOk = AckManager_send(config, sessionToken, result.uploadedIds);
    if (!ackOk) {
      LogManager.warn('ACK failed. Rows will be recovered by cron and re-sent.');
    }
  }

  LogManager.info('OCI sync complete.');
}
