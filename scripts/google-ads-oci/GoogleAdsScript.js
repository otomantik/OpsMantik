/**
 * OpsMantik → Google Ads Offline Conversion Sync (Exit Valve)
 *
 * Configured for: Eslamed (eslamed.com)
 * Site ID: 81d957f3c7534f53b12ff305f9f07ae7
 *
 * Consumes GET /api/oci/google-ads-export (offline_conversion_queue, status = QUEUED)
 * and uploads conversions via AdsApp.bulkUploads().newCsvUpload().forOfflineConversions().
 *
 * Override via script properties: OPSMANTIK_EXPORT_URL, OPSMANTIK_API_KEY
 *
 * API response shape (each item):
 *   id, gclid, wbraid, gbraid, conversionName, conversionTime, conversionValue, conversionCurrency
 * conversionTime format: yyyy-MM-dd HH:mm:ss+00:00
 */
function main() {
  var siteId = '81d957f3c7534f53b12ff305f9f07ae7'; // Eslamed (eslamed.com)
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

  if (!Array.isArray(conversions) || conversions.length === 0) {
    Logger.log('OpsMantik: 0 records to upload.');
    return;
  }

  // Google Ads bulk upload columns for offline conversions (match template "Conversions from clicks").
  // Use the column names from your account's template (Tools > Bulk actions > Uploads > View templates).
  var columns = [
    'Google Click ID',
    'Conversion name',
    'Conversion time',
    'Conversion value',
    'Conversion currency'
  ];

  var upload = AdsApp.bulkUploads().newCsvUpload(columns, { moneyInMicros: false });
  upload.forOfflineConversions();
  upload.setFileName('OpsMantik_OCI_' + new Date().getTime() + '.csv');

  var appended = 0;
  var skipped = 0;
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
    var conversionValue = Number(row.conversionValue);
    var conversionCurrency = (row.conversionCurrency != null) ? String(row.conversionCurrency) : 'TRY';

    if (!conversionTime) {
      Logger.log('Skip row (no conversion time): id=' + (row.id || i));
      skipped++;
      continue;
    }
    if (!Number.isFinite(conversionValue) || conversionValue < 0) {
      conversionValue = 0;
    }

    // Template uses "Google Click ID" for the click identifier. For WBRAID/GBRAID some templates
    // use columns "WBRAID" / "GBRAID". If your template has separate columns, add them and pass
    // the appropriate one; here we send the single click id in "Google Click ID" (works when
    // the account uses GCLID-style imports; for iOS-only columns adjust per your template).
    upload.append({
      'Google Click ID': clickId,
      'Conversion name': conversionName,
      'Conversion time': conversionTime,
      'Conversion value': conversionValue,
      'Conversion currency': conversionCurrency
    });
    appended++;
  }

  if (appended === 0) {
    Logger.log('OpsMantik: no valid rows to upload (all skipped: ' + skipped + ').');
    return;
  }

  try {
    upload.apply();
    Logger.log('OpsMantik: applied ' + appended + ' conversions; skipped ' + skipped);
  } catch (e) {
    Logger.log('OpsMantik upload.apply() error: ' + e.toString());
  }
}
