/**
 * ========================================================================
 * OPSMANTIK QUANTUM ENGINE (V14.0) - Google Ads Offline Conversion Importer
 * Client: Eslamed (eslamed.com)
 * ========================================================================
 *
 * BUG FIXES vs V13.0:
 *  1. Upload crash path: Google Ads API hatası → TRANSIENT retry (eskisi: tüm items DEAD_LETTER)
 *  2. Validation fail: identifier yoksa → VALIDATION fatal (doğru)
 *  3. Nack ayrımı: transient vs permanent net ayrıldı
 *  4. seal_ ve signal_ aynı CSV'ye gidebilir (Google conversion name ile ayırt eder)
 */

const CONFIG = {
  API_URL: 'https://api.opsmantik.com',
  SITE_ID: '81d957f3c7534f53b12ff305f9f07ae7',
  X_API_KEY: 'becaef33f722de5f08691091bbe2cbb7fba0594e56ccbfb4c8a15b3ebedd2cf1',
  TIMEZONE: '+0300',
  CHUNK_SIZE: 50,
  MAX_EXECUTION_MS: 25 * 60 * 1000
};

// ---------------------------------------------------------------------------
// Ana akış
// ---------------------------------------------------------------------------

function main() {
  const startTime = Date.now();
  Logger.log('[OPSMANTIK] V14.0 Started | Site: ' + CONFIG.SITE_ID);

  let nextCursor = null;
  let keepFetching = true;
  let totalDispatched = 0;

  while (keepFetching) {
    if (Date.now() - startTime > CONFIG.MAX_EXECUTION_MS) {
      Logger.log('[WARNING] 25dk limitine yaklaşıldı. Graceful halt. Kalan veri sonraki çalışmada işlenecek.');
      break;
    }

    const exportData = fetchOpsMantikData(nextCursor);
    if (!exportData || !exportData.items || exportData.items.length === 0) {
      Logger.log('[INFO] Yeni dönüşüm yok. Bekleniyor.');
      break;
    }

    const items = exportData.items;
    Logger.log('[INFO] ' + items.length + ' item çekildi. Chunk boyutu: ' + CONFIG.CHUNK_SIZE);

    for (let i = 0; i < items.length; i += CONFIG.CHUNK_SIZE) {
      if (Date.now() - startTime > CONFIG.MAX_EXECUTION_MS) {
        Logger.log('[WARNING] Chunk döngüsünde limit aşıldı, durduruluyor.');
        keepFetching = false;
        break;
      }

      const chunk = items.slice(i, i + CONFIG.CHUNK_SIZE);
      const result = processChunk(chunk);

      // ── Başarılı upload ──────────────────────────────────────────────────
      if (result.successIds.length > 0) {
        sendAck(result.successIds);
        totalDispatched += result.successIds.length;
        Logger.log('[ACK] ' + result.successIds.length + ' item onaylandı.');
      }

      // ── Geçici Google Ads hatası → RETRY (V13 hatası: bunlar dead-letter gidiyordu) ──
      if (result.transientIds.length > 0) {
        sendNack(result.transientIds, [], 'UPLOAD_ERROR', 'Google Ads API geçici hata', 'TRANSIENT');
        Logger.log('[NACK-TRANSIENT] ' + result.transientIds.length + ' item retry kuyruğuna alındı.');
      }

      // ── Validation hatası → kalıcı fail (identifier yok) ────────────────
      if (result.validationFatalIds.length > 0) {
        sendNack([], result.validationFatalIds, 'NO_IDENTIFIER', 'gclid/wbraid/gbraid/phone bulunamadı', 'VALIDATION');
        Logger.log('[NACK-FATAL] ' + result.validationFatalIds.length + ' item kalıcı olarak reddedildi.');
      }
    }

    nextCursor = exportData.next_cursor;
    if (!nextCursor) {
      Logger.log('[INFO] Tüm sayfalar işlendi.');
      keepFetching = false;
    }
  }

  Logger.log('[DONE] Toplam gönderilen: ' + totalDispatched);
}

// ---------------------------------------------------------------------------
// Export API çağrısı
// ---------------------------------------------------------------------------

function fetchOpsMantikData(cursor) {
  let url = CONFIG.API_URL + '/api/oci/google-ads-export?siteId=' + CONFIG.SITE_ID + '&markAsExported=true';
  if (cursor) url += '&cursor=' + encodeURIComponent(cursor);

  const options = {
    method: 'get',
    headers: { 'x-api-key': CONFIG.X_API_KEY, 'Accept': 'application/json' },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code !== 200) {
    Logger.log('[ERROR] Export API: HTTP ' + code + ' → ' + response.getContentText().slice(0, 500));
    return null;
  }
  return JSON.parse(response.getContentText());
}

// ---------------------------------------------------------------------------
// Chunk işleme
// Döndürür: { successIds, transientIds, validationFatalIds }
// ---------------------------------------------------------------------------

function processChunk(items) {
  const validItems = [];
  const validationFatalIds = [];  // identifier eksik → kalıcı red

  // 1. Validation
  items.forEach(function(item) {
    const gclid  = (item.gclid  || '').trim();
    const wbraid = (item.wbraid || '').trim();
    const gbraid = (item.gbraid || '').trim();
    const phone  = (item.hashed_phone_number || '').trim();

    if (!gclid && !wbraid && !gbraid && !phone) {
      Logger.log('[VALIDATION] ID yok, reddedildi: ' + item.id);
      validationFatalIds.push(item.id);
    } else {
      validItems.push(item);
    }
  });

  if (validItems.length === 0) {
    return { successIds: [], transientIds: [], validationFatalIds: validationFatalIds };
  }

  // 2. CSV oluştur
  let csvContent = 'Parameters:TimeZone=' + CONFIG.TIMEZONE + '\n';
  csvContent += 'Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Gclid,Wbraid,Gbraid,Hashed Phone Number\n';

  validItems.forEach(function(item) {
    const gclid    = escapeCsv(item.gclid  || '');
    const wbraid   = escapeCsv(item.wbraid || '');
    const gbraid   = escapeCsv(item.gbraid || '');
    const phone    = escapeCsv(item.hashed_phone_number || '');
    const name     = escapeCsv(item.conversionName || '');
    const time     = escapeCsv(item.conversionTime || '');
    const value    = Number(item.conversionValue) || 0;
    const currency = escapeCsv(item.conversionCurrency || 'TRY');

    csvContent += '"' + name + '","' + time + '",' + value + ',"' + currency + '","' + gclid + '","' + wbraid + '","' + gbraid + '","' + phone + '"\n';
  });

  const validIds = validItems.map(function(i) { return i.id; });

  // 3. Google Ads'e yükle
  try {
    const blob = Utilities.newBlob(csvContent, 'text/csv', 'OpsMantik_OCI_' + Date.now() + '.csv');
    const upload = AdsApp.fileUploads()
      .newOfflineConversionUpload()
      .forCsvUpload()
      .setFileName('OpsMantik_OCI_' + Date.now() + '.csv')
      .build();
    upload.apply(blob);

    Logger.log('[UPLOAD OK] ' + validIds.length + ' conversion CSV\'ye yüklendi.');
    // pendingConfirmation=true ile ACK → seal_* UPLOADED, signal_* SENT olur
    return { successIds: validIds, transientIds: [], validationFatalIds: validationFatalIds };

  } catch (e) {
    // ── V13 BUG FIX ──────────────────────────────────────────────────────
    // V13: tüm validIds → fatalErrorIds → DEAD_LETTER_QUARANTINE
    // V14: tüm validIds → transientIds → RETRY (geçici hata, yeniden denenecek)
    Logger.log('[GOOGLE ADS UPLOAD ERROR] ' + e.message + ' | ' + validIds.length + ' item RETRY kuyruğuna alınıyor.');
    return { successIds: [], transientIds: validIds, validationFatalIds: validationFatalIds };
  }
}

// ---------------------------------------------------------------------------
// ACK — başarılı upload
// ---------------------------------------------------------------------------

function sendAck(successIds) {
  const payload = {
    siteId: CONFIG.SITE_ID,
    queueIds: successIds,
    pendingConfirmation: true   // AdsApp CSV upload async, UPLOADED durumunda bırakır
  };
  apiPost(CONFIG.API_URL + '/api/oci/ack', payload);
}

// ---------------------------------------------------------------------------
// NACK — hata
//   queueIds      → TRANSIENT retry (geçici hatalar)
//   fatalErrorIds → kalıcı red (DEAD_LETTER veya FAILED)
// ---------------------------------------------------------------------------

function sendNack(queueIds, fatalErrorIds, code, message, category) {
  const payload = {
    siteId: CONFIG.SITE_ID,
    queueIds: queueIds,
    fatalErrorIds: fatalErrorIds,
    errorCode: code,
    errorMessage: message,
    errorCategory: category   // 'TRANSIENT' | 'VALIDATION' | 'AUTH'
  };
  apiPost(CONFIG.API_URL + '/api/oci/ack-failed', payload);
}

// ---------------------------------------------------------------------------
// HTTP POST yardımcısı
// ---------------------------------------------------------------------------

function apiPost(url, payload) {
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': CONFIG.X_API_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code !== 200) {
    Logger.log('[ACK/NACK ERROR] HTTP ' + code + ' → ' + response.getContentText().slice(0, 300));
  }
}

// ---------------------------------------------------------------------------
// CSV güvenli escape
// ---------------------------------------------------------------------------

function escapeCsv(str) {
  return String(str).replace(/"/g, '""');
}
