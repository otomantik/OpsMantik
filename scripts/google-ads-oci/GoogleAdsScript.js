/**
 * OpsMantik → Google Ads Offline Conversion Sync (Exit Valve) — Iron Seal Multi-Tenant
 *
 * Script Properties (File → Project properties → Script properties):
 *   OPSMANTIK_SITE_ID  — Site UUID or public_id (required)
 *   OPSMANTIK_API_KEY — API key for OCI (required)
 *   OPSMANTIK_EXPORT_URL — Optional; default https://console.opsmantik.com/api/oci/google-ads-export
 *   OPSMANTIK_USE_V2_VERIFY — Optional; "true" to use v2 handshake (recommended)
 *
 * Flow: 1) Handshake (v2/verify) → session_token  2) Export  3) Upload to Google  4) ACK
 * No hardcoded site IDs — all from Script Properties.
 */
function main() {
  var props = PropertiesService.getScriptProperties();
  var siteId = (props.getProperty('OPSMANTIK_SITE_ID') || '').trim();
  var apiKey = (props.getProperty('OPSMANTIK_API_KEY') || '').trim();
  var exportUrl = (props.getProperty('OPSMANTIK_EXPORT_URL') || 'https://console.opsmantik.com/api/oci/google-ads-export').trim();
  var baseUrl = exportUrl.replace(/\/api\/oci\/google-ads-export.*$/, '') || 'https://console.opsmantik.com';
  var useV2Verify = (props.getProperty('OPSMANTIK_USE_V2_VERIFY') || 'false').toLowerCase() === 'true';

  if (!siteId || !apiKey) {
    Logger.log('OpsMantik: Set OPSMANTIK_SITE_ID and OPSMANTIK_API_KEY in Script Properties.');
    return;
  }

  var authHeader = { 'x-api-key': apiKey };
  var sessionToken = null;

  if (useV2Verify) {
    var verifyResp;
    try {
      verifyResp = UrlFetchApp.fetch(baseUrl + '/api/oci/v2/verify', {
        method: 'post',
        muteHttpExceptions: true,
        contentType: 'application/json',
        headers: { 'x-api-key': apiKey },
        payload: JSON.stringify({ siteId: siteId })
      });
    } catch (e) {
      Logger.log('OpsMantik v2/verify error: ' + e.toString());
      return;
    }
    if (verifyResp.getResponseCode() !== 200) {
      Logger.log('OpsMantik v2/verify failed: HTTP ' + verifyResp.getResponseCode() + ' ' + verifyResp.getContentText());
      return;
    }
    var verifyJson;
    try {
      verifyJson = JSON.parse(verifyResp.getContentText());
    } catch (e) {
      Logger.log('OpsMantik v2/verify parse error: ' + e.toString());
      return;
    }
    if (verifyJson.session_token) {
      sessionToken = verifyJson.session_token;
      authHeader = { 'Authorization': 'Bearer ' + sessionToken };
    }
  }

  var url = exportUrl + '?siteId=' + encodeURIComponent(siteId) + '&markAsExported=true';
  var options = {
    method: 'get',
    muteHttpExceptions: true,
    headers: Object.assign({ 'Accept': 'application/json' }, authHeader)
  };

  var response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (e) {
    Logger.log('OpsMantik fetch error: ' + e.toString());
    return;
  }

  var code = response.getResponseCode();
  if (code !== 200) {
    Logger.log('OpsMantik API error: HTTP ' + code + ' ' + response.getContentText());
    return;
  }

  var jsonText = response.getContentText();
  var conversions;
  try {
    conversions = JSON.parse(jsonText);
  } catch (e) {
    Logger.log('OpsMantik parse error: ' + e.toString());
    return;
  }

  if (!Array.isArray(conversions)) {
    Logger.log('OpsMantik: response is not an array: ' + jsonText.substring(0, 200));
    return;
  }
  Logger.log('OpsMantik: API returned ' + conversions.length + ' record(s). Site: ' + siteId);
  if (conversions.length === 0) {
    return;
  }

  var columns = [
    'Order ID',
    'Google Click ID',
    'Conversion name',
    'Conversion time',
    'Conversion value',
    'Conversion currency'
  ];

  var upload = AdsApp.bulkUploads().newCsvUpload(columns, {
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
      Logger.log('Skip row (no click id): id=' + (row.id || i));
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
      Logger.log('Skip row (no conversion time): id=' + (row.id || i));
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

  if (appended === 0) {
    Logger.log('OpsMantik: no valid rows to upload (all skipped: ' + skipped + ').');
    return;
  }

  try {
    upload.apply();
    Logger.log('OpsMantik: applied ' + appended + ' conversions; skipped ' + skipped);
    if (uploadedIds.length > 0) {
      Logger.log('=> Starting ACK process for ' + uploadedIds.length + ' conversions.');
      var ackUrl = baseUrl + '/api/oci/ack';
      var maxRetries = 3;
      var ackOk = false;
      for (var attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          var payload = { siteId: siteId, queueIds: uploadedIds };
          Logger.log('=> ACK attempt ' + attempt + '/' + maxRetries);
          var ackResp = UrlFetchApp.fetch(ackUrl, {
            method: 'post',
            muteHttpExceptions: true,
            contentType: 'application/json',
            headers: authHeader,
            payload: JSON.stringify(payload)
          });
          var ackCode = ackResp.getResponseCode();
          var ackBody = ackResp.getContentText();
          Logger.log('=> ACK Response Code: ' + ackCode);
          if (ackCode === 200) {
            ackOk = true;
            try {
              var parsed = JSON.parse(ackBody || '{}');
              Logger.log('=> ACK success (updated: ' + (parsed.updated != null ? parsed.updated : '?') + ')');
            } catch (e) { Logger.log('=> ACK success (HTTP 200)'); }
            break;
          }
          Logger.log('!!! ACK FAILED: HTTP ' + ackCode + ' ' + ackBody);
          if (attempt < maxRetries && ackCode >= 500) {
            Utilities.sleep(2000);
          } else {
            break;
          }
        } catch (ackErr) {
          Logger.log('!!! ACK FAILED (attempt ' + attempt + '): ' + ackErr.toString());
          if (attempt < maxRetries) Utilities.sleep(2000);
        }
      }
      if (!ackOk) {
        Logger.log('!!! ACK failed after ' + maxRetries + ' attempts. Rows will be recovered by cron and re-sent.');
      }
    }
  } catch (e) {
    Logger.log('OpsMantik upload.apply() error: ' + e.toString());
  }
}
