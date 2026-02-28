/**
 * OpsMantik → Google Ads Offline Conversion Sync (Exit Valve)
 *
 * Configured for: Eslamed (eslamed.com) — queue data is under this site UUID.
 * API accepts either site UUID or public_id; queue is keyed by site_id (UUID).
 *
 * Consumes GET /api/oci/google-ads-export (offline_conversion_queue, status = QUEUED)
 * and uploads conversions via AdsApp.bulkUploads().newCsvUpload().forOfflineConversions().
 *
 * Override via script properties: OPSMANTIK_EXPORT_URL, OPSMANTIK_API_KEY
 *
 * API response shape (each item):
 *   id, orderId, gclid, wbraid, gbraid, conversionName, conversionTime, conversionValue, conversionCurrency
 * orderId: sent to Google as Order ID so duplicate uploads (same orderId) are ignored by Google.
 * conversionTime format: yyyy-mm-dd hh:mm:ss+0300 (Turkey Time)
 * conversionValue: numeric only (no ₺ or other symbols). conversionCurrency: TRY.
 */
function main() {
  // Kuyruk verisi bu site_id altında (b1264552...). public_id yerine UUID kullanıyoruz.
  var siteId = 'b1264552-c859-40cb-a3fb-0ba057afd070'; // Eslamed – queue site
  var exportUrl = typeof OPSMANTIK_EXPORT_URL !== 'undefined'
    ? OPSMANTIK_EXPORT_URL
    : 'https://console.opsmantik.com/api/oci/google-ads-export';
  var apiKey = typeof OPSMANTIK_API_KEY !== 'undefined'
    ? OPSMANTIK_API_KEY
    : 'zyHDNxdZlQKp9eMCBXuUeMoILApnk2uSTV7OpMKw3To=';

  var url = exportUrl + '?siteId=' + encodeURIComponent(siteId) + '&markAsExported=true';
  var options = {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      'x-api-key': apiKey,
      'Accept': 'application/json'
    }
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
  Logger.log('OpsMantik: API returned ' + conversions.length + ' record(s). URL: ' + url);
  if (conversions.length === 0) {
    Logger.log('OpsMantik: 0 records to upload. Check queue: SELECT * FROM offline_conversion_queue WHERE site_id = \'b1264552-c859-40cb-a3fb-0ba057afd070\' AND status = \'QUEUED\';');
    return;
  }

  // Google Ads bulk upload columns for offline conversions (match template "Conversions from clicks").
  // Order ID: Google deduplicates by this; same orderId sent twice → second is ignored. Use queue row id.
  // If your template does not have "Order ID", add it or remove from columns and from upload.append() below.
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
  var uploadedIds = []; // queue row ids successfully appended (for ack)
  for (var i = 0; i < conversions.length; i++) {
    var row = conversions[i];
    var gclid = (row.gclid || '').toString().trim();
    var wbraid = (row.wbraid || '').toString().trim();
    var gbraid = (row.gbraid || '').toString().trim();

    // Google requires exactly one of: GCLID, WBRAID, or GBRAID per row.
    var clickId = gclid || wbraid || gbraid;
    if (!clickId) {
      Logger.log('Skip row (no click id): id=' + (row.id || i));
      skipped++;
      continue;
    }

    var conversionName = (row.conversionName != null) ? String(row.conversionName) : 'Sealed Lead';
    var conversionTime = (row.conversionTime != null) ? String(row.conversionTime) : '';
    // Strip currency symbols (e.g. ₺) — Conversion value must be numeric only.
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
    // Template uses "Google Click ID" for the click identifier. For WBRAID/GBRAID some templates
    // use columns "WBRAID" / "GBRAID". If your template has separate columns, add them and pass
    // the appropriate one; here we send the single click id in "Google Click ID" (works when
    // the account uses GCLID-style imports; for iOS-only columns adjust per your template).
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
    // Ack: mark these queue rows as COMPLETED so they are not re-sent (recover won't move them to RETRY).
    // Retry up to 3 times on failure (transient 5xx, network errors).
    if (uploadedIds.length > 0) {
      Logger.log('=> Starting ACK process for ' + uploadedIds.length + ' conversions.');
      var ackUrl = (typeof OPSMANTIK_EXPORT_URL !== 'undefined'
        ? OPSMANTIK_EXPORT_URL.replace(/\/api\/oci\/google-ads-export.*$/, '')
        : 'https://console.opsmantik.com') + '/api/oci/ack';
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
            headers: { 'x-api-key': apiKey },
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
