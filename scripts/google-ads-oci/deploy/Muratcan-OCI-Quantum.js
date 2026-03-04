/**
 * ========================================================================
 * OPSMANTIK QUANTUM ENGINE (V13.0) - Google Ads Offline Conversion Importer
 * Client: Muratcan AKÜ (muratcanaku.com)
 * ========================================================================
 * Architecture: Bifurcated Cursors, Micro-Batching, Graceful 25m Halting.
 * Status: PRODUCTION READY
 */

const CONFIG = {
  API_URL: 'https://api.opsmantik.com',
  SITE_ID: '28cf0aefaa074f5bb29e818a9d53b488',
  X_API_KEY: '3a1a48f946a1f42c584dc15975ff95c2cb2cb0ab23beffc79c5bb03b0fb47726',
  TIMEZONE: '+0300',
  CHUNK_SIZE: 50,
  MAX_EXECUTION_MS: 25 * 60 * 1000
};

function main() {
  const startTime = Date.now();
  Logger.log(`[OPSMANTIK] Quantum Engine Started | Site ID: ${CONFIG.SITE_ID}`);

  let nextCursor = null;
  let keepFetching = true;
  let totalProcessed = 0;

  while (keepFetching) {
    if (Date.now() - startTime > CONFIG.MAX_EXECUTION_MS) {
      Logger.log('[WARNING] Approaching 25-minute execution limit. Halting gracefully. Remaining data will process next hour.');
      break;
    }

    const exportData = fetchOpsMantikData(nextCursor);

    if (!exportData || !exportData.items || exportData.items.length === 0) {
      Logger.log('[INFO] No new conversions found. Engine sleeping.');
      break;
    }

    const items = exportData.items;
    Logger.log(`[INFO] Pulled ${items.length} conversions. Pushing to Google Ads in chunks of ${CONFIG.CHUNK_SIZE}...`);

    for (let i = 0; i < items.length; i += CONFIG.CHUNK_SIZE) {
      if (Date.now() - startTime > CONFIG.MAX_EXECUTION_MS) {
        Logger.log('[WARNING] Execution limit reached during chunking. Breaking loop.');
        keepFetching = false;
        break;
      }

      const chunk = items.slice(i, i + CONFIG.CHUNK_SIZE);
      const { successIds, fatalErrorIds } = processChunk(chunk);

      if (successIds.length > 0) {
        sendAck(successIds);
        totalProcessed += successIds.length;
      }
      if (fatalErrorIds.length > 0) {
        sendNack(fatalErrorIds, "UPLOAD_FAILED", "Format or Google Ads Rejection", "VALIDATION");
      }
    }

    nextCursor = exportData.next_cursor;
    if (!nextCursor) {
      Logger.log('[INFO] All pages processed successfully.');
      keepFetching = false;
    }
  }

  Logger.log(`[SUCCESS] Quantum Engine Finished. Total Signals Dispatched: ${totalProcessed}`);
}

function fetchOpsMantikData(cursor) {
  let url = `${CONFIG.API_URL}/api/oci/google-ads-export?siteId=${CONFIG.SITE_ID}&markAsExported=true`;
  if (cursor) {
    url += `&cursor=${encodeURIComponent(cursor)}`;
  }
  const options = {
    method: 'get',
    headers: { 'x-api-key': CONFIG.X_API_KEY, 'Accept': 'application/json' },
    muteHttpExceptions: true
  };
  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    Logger.log(`[ERROR] API unreachable. Code: ${response.getResponseCode()} | Response: ${response.getContentText()}`);
    return null;
  }
  return JSON.parse(response.getContentText());
}

function processChunk(items) {
  const successIds = [];
  const fatalErrorIds = [];

  let csvContent = `Parameters:TimeZone=${CONFIG.TIMEZONE}\n`;
  csvContent += 'Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Gclid,Wbraid,Gbraid,Hashed Phone Number\n';
  let hasValidData = false;

  items.forEach(item => {
    try {
      if (!item.gclid && !item.wbraid && !item.gbraid && !item.hashed_phone_number) {
        throw new Error('No identifiers found');
      }
      const gclid = item.gclid || '';
      const wbraid = item.wbraid || '';
      const gbraid = item.gbraid || '';
      const phone = item.hashed_phone_number || '';
      const value = item.conversionValue || 0;
      const currency = item.conversionCurrency || 'TRY';

      const row = `"${item.conversionName}","${item.conversionTime}",${value},"${currency}","${gclid}","${wbraid}","${gbraid}","${phone}"`;
      csvContent += row + '\n';

      successIds.push(item.id);
      hasValidData = true;
    } catch (e) {
      Logger.log(`[VALIDATION ERROR] Signal ID ${item.id} rejected: ${e.message}`);
      fatalErrorIds.push(item.id);
    }
  });

  if (hasValidData) {
    try {
      const blob = Utilities.newBlob(csvContent, 'text/csv', 'OpsMantik_Upload.csv');
      const upload = AdsApp.fileUploads().newOfflineConversionUpload()
        .forCsvUpload()
        .setFileName(`OpsMantik_OCI_${Date.now()}.csv`)
        .build();
      upload.apply(blob);
    } catch (e) {
      Logger.log(`[GOOGLE ADS ERROR] Upload engine crashed: ${e.message}`);
      return { successIds: [], fatalErrorIds: [...successIds, ...fatalErrorIds] };
    }
  }
  return { successIds, fatalErrorIds };
}

function sendAck(successIds) {
  const payload = { siteId: CONFIG.SITE_ID, queueIds: successIds, pendingConfirmation: true };
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': CONFIG.X_API_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  UrlFetchApp.fetch(`${CONFIG.API_URL}/api/oci/ack`, options);
}

function sendNack(fatalIds, code, message, category) {
  const payload = {
    siteId: CONFIG.SITE_ID, queueIds: [], fatalErrorIds: fatalIds,
    errorCode: code, errorMessage: message, errorCategory: category
  };
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': CONFIG.X_API_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  UrlFetchApp.fetch(`${CONFIG.API_URL}/api/oci/ack-failed`, options);
}
