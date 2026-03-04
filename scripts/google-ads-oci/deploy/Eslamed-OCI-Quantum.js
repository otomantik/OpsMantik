/**
 * OCI SYNC ENGINE v4.0 (Quantum Void Edition) — Eslamed
 * Site: Eslamed (eslamed.com)
 * Architecture: THE VOID — Absolute Zero Tolerance
 */

'use strict';

// ========================================================================
// ESLAMED DEFAULTS
// ========================================================================
var ESLAMED_SITE_ID = '81d957f3c7534f53b12ff305f9f07ae7';   // Eslamed public_id
var ESLAMED_BASE_URL = 'https://console.opsmantik.com';
var ESLAMED_API_KEY = 'becaef33f722de5f08691091bbe2cbb7fba0594e56ccbfb4c8a15b3ebedd2cf1';

// paste your VOID_PRIVATE_KEY (Base64) here.
var VOID_PRIVATE_KEY_B64 = 'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JSUV2Z0lCQURBTkJna3Foa2lHOXcwQkFRRUZBQVNDQktnd2dnU2tBZ0VBQW9JQkFRQ3RhaGJFVER5RlF3ZmoKZGZRd1FlZmsyMkRZbjlIamIvZzhZV21Qdlg1YUFXTmQ2YzVZQ1VCczZ0bU1mSnl5Z3FadUxJbEY4SDFtM2E0SQplSm80QWw1V1N6U1Bjd0dRYXlsM1hZTmdjc1czWHNnbGRyYUdQbUx6dHhlWUtveEU5US9VWnprdmpYVTVZOWVLClJvRWJrSDEvRHpRMkRwZmxPVjRibzVKRXQ2SmZWd2l0Y0RkdDFybzhTK2FxR2dHYnluNEVCVGIrNTJYVDEyRWQKME1XMlZMYzAxNEljQUJQZjV2b3M3NytDMGl1ditnK3ovV2Z1MCtrMG8vQWtwTDg1T2N6ZWF0endqdk1POHduNgpvRGxTdHFpUFNEeG9ZRVFPVVE5UlJwa2o2VVBCQzdxck5QVi9UQ2xyN2dXM0kzd0ZlU3JxL2ovUGh1TFFPWnhoCkhxZktWbjRqQWdNQkFBRUNnZ0VBVGFaVzZtL2VtNmRQcFhUZ01pbVlyaHZqYWl4cUhjYTU1ME9STW9sZHhleWcKTTJHcGdUY25UMzM3aXRJVGtrVTVROVVTWkt4U1lwaTV3RlpNYSs3M2tmbGI0QzNWa2ZiQ0d3NVc4UDJEZGQvdApqQVR6cHZuUmNpTFdZRThRL3lHaWhHL3lKYzVZSXFvSHpnVlM4MlpJSTNoSjN6aTZvQ3dIYlNYWnJZWnlvUENKClpuVWVDYnBDc1hoWklJVjhyNnhNQXJkTE9USTFUb2U2ZkREZTB2VXkxdUloNDJhQ09sL0E2WHhuMytPZjdSNEwKQlh6ZUg1YXVpQnE0QTNROXVPU0did1UySXBTRk94OHNnbDZUZ3oxeUQxOEp1Qkl1bGFTUDVkMWMzbGM3ZlcyUwpadTF4QVpZRVIvSEh1N21mVm9zMkpCEyptenFNR2hPWm1sNjBjT285SVFLQmdRRGRqbUUybE9EalY4ZHIwc1o5CkpZSy93dFR1Q2doQmJxb21sTGc0SVZXdjdYOWF2bDU0L0dnN2o5bkNRY2xaVlRNc2FTTDRxOHhvNlczWDdSRm4KQ2VyRjFkdWR2c3I5WXBGanBkS0pMV1JXYmUvcStzR3BiMmRxVHN2WXRqZ1FETFhOTUNLKzZtTXZBRXh3TzFuKwpLSUtIWGwyVTUyTDA2MktQTHp4NVpsVzhZUUtCZ1FESVg3eFNEOHlJbXNSeCtHV0l5WjRTSkNVWThRNCsyaHUxCkFmTkg5dUpXamQ3NG0wN3puMURHODRzVE5GMEZDRldUT2ZjWmZjSTJaS29zeEwxUkdadEFmY3VreXJtRHhaQW4KaGhxOW8zWXNJKzBra053UGp2cEdudEYxV2RjMEpNSEE1Z1VvcWJDS3E3YnhOblVEL2dNM2ZhK1hoUVowR2hWRwptd0ZXNG9IcEF3S0JnSERJMURBRzVkeVZpTTBZeFRaYjdBMVdUekxHSktHNmhoK1J3WjNCU205K2hVQmFmSmsyClZKRk5qMXJXUm51VlpiR0w2K09QQVVXKzNzMzJ2czhuT3o1dXVaZTUwbmZldjRoc2w1cUJZdnlraG1lbU13UGYKMUZOSHZYbWFlVHVpWE1JUmFQNnJMc1owYm5VTG9hcENVUUE4UjROUHJ3NWk3UTlheW53NlhoYkJBb0dCQUtKbwo5cnVORXJ1bXRwT3FRcUljeVlMcXlTYnVQQjIxcTcrTFZTVi9kdld4Q0lsNVdRVWVuTnFsakpTRVhPRTNZQ1YxClZsUFRHeGY3Zi9QSmc2bTRsNTR1V0dHNTc2UmUvZmtMT2FGOFhNeHFVa3pSSFkxKzFsMW5YVjlBOHEzUkhUcTkKTm5FL0dWbE0xWHV1S0NxVU9RZEJXSkgzd01OYVlPUlp2end0WEI4QkFvR0JBS01LdDRhQUpvZ1FiU1psV1RqTwoxUndySUsybUtZTXhlREN3QWV6a242c1l3cGxMZGxDbzBLZGN6T05EcjBDWEdRZFhRVG1kOEV0WnVadHJhQkVQCmpScEN2TmJFZlpVSERKSXZtQXE5a09UVzJwRi9sM3JOdzBKSDViUDVrMGozSHk2MDFzTUs5Q25KTmk4Zy9FcTEKWVRZR21Cc0Y2VkVtbnY3WHFGK3Fjb0tsCi0tLS0tRU5EIFBSSVZBVEUgS0VZLS0tLS0K';

// ========================================================================
// CONFIGURATION
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
    return fallback || '';
  };

  return Object.freeze({
    SITE_ID: get('OPSMANTIK_SITE_ID', ESLAMED_SITE_ID),
    API_KEY: get('OPSMANTIK_API_KEY', ESLAMED_API_KEY),
    BASE_URL: get('OPSMANTIK_BASE_URL', ESLAMED_BASE_URL),
    PRIVATE_KEY: get('VOID_PRIVATE_KEY', VOID_PRIVATE_KEY_B64),
    HTTP: Object.freeze({
      MAX_RETRIES: 5,
      INITIAL_DELAY_MS: 1500,
      TIMEOUT_MS: 60000,
    }),
  });
}
var CONFIG = getConfig();

// ========================================================================
// CRYPTO ENGINE
// ========================================================================
class CryptoEngine {
  static sign(payload) {
    if (!CONFIG.PRIVATE_KEY) return null;
    try {
      var header = { alg: 'RS256', typ: 'JWT' };
      var iat = Math.floor(Date.now() / 1000);
      var jwtPayload = Object.assign({}, payload, {
        iss: 'opsmantik-oci-script',
        aud: 'opsmantik-api',
        iat: iat,
        exp: iat + 300
      });

      var base64Encode = function (obj) {
        var str = JSON.stringify(obj);
        return Utilities.base64EncodeWebSafe(str).replace(/=+$/, '');
      };

      var unsignedToken = base64Encode(header) + "." + base64Encode(jwtPayload);
      var privKeyStr = Utilities.newBlob(Utilities.base64Decode(CONFIG.PRIVATE_KEY)).getDataAsString();
      var signature = Utilities.computeRsaSha256Signature(unsignedToken, privKeyStr);
      var signatureB64 = Utilities.base64EncodeWebSafe(signature).replace(/=+$/, '');

      return unsignedToken + "." + signatureB64;
    } catch (e) {
      return null;
    }
  }

  static decrypt(protectedPayload) {
    // RSA-OAEP Decryption fallback: return raw if polyfill missing
    return JSON.parse(protectedPayload);
  }
}

// ========================================================================
// TELEMETRY
// ========================================================================
var Telemetry = {
  info: function (msg) { Logger.log('[INFO] ' + msg); },
  warn: function (msg) { Logger.log('[WARN] ' + msg); },
  error: function (msg, e) { Logger.log('[ERROR] ' + msg + (e ? ' | ' + e.message : '')); }
};

// ========================================================================
// NETWORK LAYER
// ========================================================================
class QuantumClient {
  constructor() {
    this.baseUrl = CONFIG.BASE_URL.replace(/\/+$/, '');
  }

  fetchConversions() {
    var url = this.baseUrl + '/api/oci/google-ads-export?siteId=' + encodeURIComponent(CONFIG.SITE_ID) + '&markAsExported=true';
    var options = {
      method: 'get',
      headers: { 'x-api-key': CONFIG.API_KEY, 'Accept': 'application/json' },
      muteHttpExceptions: true
    };
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    if (code !== 200) throw new Error('API Error ' + code);

    var data = JSON.parse(response.getContentText());
    if (data.protected) return CryptoEngine.decrypt(data.protected);
    return data;
  }

  sendAck(queueIds, skippedIds) {
    var url = this.baseUrl + '/api/oci/ack';
    var payload = { siteId: CONFIG.SITE_ID, queueIds: queueIds, skippedIds: skippedIds, pendingConfirmation: true };
    var token = CryptoEngine.sign({ action: 'ack', ids: queueIds });
    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': CONFIG.API_KEY, 'x-oci-signature': token || '' },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    UrlFetchApp.fetch(url, options);
  }

  sendAckFailed(queueIds, code, msg) {
    var url = this.baseUrl + '/api/oci/ack-failed';
    var payload = { siteId: CONFIG.SITE_ID, queueIds: queueIds, errorCode: code, errorMessage: msg };
    var token = CryptoEngine.sign({ action: 'ack-failed', ids: queueIds });
    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': CONFIG.API_KEY, 'x-oci-signature': token || '' },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    UrlFetchApp.fetch(url, options);
  }
}

// ========================================================================
// MAIN
// ========================================================================
function main() {
  Telemetry.info('Eslamed Quantum OCI Engine (Void Edition) Starting...');
  if (!CONFIG.PRIVATE_KEY) {
    Telemetry.error('VOID_PRIVATE_KEY missing.');
    return;
  }

  try {
    var client = new QuantumClient();
    var conversions = client.fetchConversions();

    if (!Array.isArray(conversions) || conversions.length === 0) {
      Telemetry.info('No pending conversions.');
      return;
    }

    var columns = ['Order ID', 'Google Click ID', 'Conversion name', 'Conversion time', 'Conversion value', 'Conversion currency', 'Phone'];
    var upload = AdsApp.bulkUploads().newCsvUpload(columns, { moneyInMicros: false });
    upload.forOfflineConversions();

    var successIds = [];
    var failedIds = [];

    for (var i = 0; i < conversions.length; i++) {
      var row = conversions[i];
      try {
        upload.append({
          'Order ID': row.orderId,
          'Google Click ID': row.gclid || row.wbraid || row.gbraid,
          'Conversion name': row.conversionName,
          'Conversion time': row.conversionTime,
          'Conversion value': row.conversionValue,
          'Conversion currency': row.conversionCurrency,
          'Phone': row.hashed_phone_number || ''
        });
        successIds.push(row.id.replace('signal_', '').replace('seal_', ''));
      } catch (e) {
        failedIds.push(row.id);
      }
    }

    if (successIds.length > 0) {
      upload.apply();
      client.sendAck(successIds, []);
    }
    if (failedIds.length > 0) {
      client.sendAckFailed(failedIds, 'SCRIPT_APPEND_ERROR', 'Row failed');
    }
    Telemetry.info('Finished. Total: ' + conversions.length);
  } catch (e) {
    Telemetry.error('Fatal error', e);
  }
}
