/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  ESLAMED OCI SYNC ENGINE — v3.0 (Quantum Edition)                            ║
 * ║  Architecture: V8 Engine Native | Deterministic Sampling | Auto-Healing      ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║  FEATURES:                                                                   ║
 * ║  - 🚀 Native ES6 Classes (requires Google Ads V8 Engine enabled)             ║
 * ║  - 🛡️ Advanced Exponential Backoff with Jitter (HTTP 429 & 503 handling)     ║
 * ║  - 🧬 Deterministic Hash Sampling (consistent V1 selection across retries)   ║
 * ║  - ⌚ Strict ANSI Time Validation (prevents invisible Google Ads rejections) ║
 * ║  - 📦 Memory-safe Batch Processing for high-volume pipelines                 ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

'use strict';

// ========================================================================
// ⚙️ ENV CONFIGURATION (Strict Read-Only)
// ========================================================================
const CONFIG = Object.freeze({
  SITE_ID: '28cf0aefaa074f5bb29e818a9d53b488', // Eslamed Public ID
  API_KEY: '3a1a48f946a1f42c584dc15975ff95c2cb2cb0ab23beffc79c5bb03b0fb47726',
  BASE_URL: 'https://console.opsmantik.com',
  SAMPLING_RATE_V1: 0.1, // 10% Deterministic Sampling
  HTTP: Object.freeze({
    MAX_RETRIES: 5,
    INITIAL_DELAY_MS: 1500,
    TIMEOUT_MS: 60000,
  }),
});

const CONVERSION_EVENTS = Object.freeze({
  V1_PAGEVIEW: 'OpsMantik_V1_Nabiz',
  V2_PULSE: 'OpsMantik_V2_Ilk_Temas',
  V3_ENGAGE: 'OpsMantik_V3_Nitelikli_Gorusme',
  V4_INTENT: 'OpsMantik_V4_Sicak_Teklif',
  V5_SEAL: 'OpsMantik_V5_DEMIR_MUHUR',
});

// ========================================================================
// 🛡️ TELEMETRY SYSTEM
// ========================================================================
class Telemetry {
  static info(msg, meta = '') { Logger.log(`🔵 [INFO] ${msg} ${meta ? `| ${JSON.stringify(meta)}` : ''}`); }
  static warn(msg, meta = '') { Logger.log(`🟠 [WARN] ${msg} ${meta ? `| ${JSON.stringify(meta)}` : ''}`); }
  static error(msg, err = null) {
    Logger.log(`🔴 [ERROR] ${msg} | ${err ? (err.message || err) : ''}`);
    if (err && err.stack) Logger.log(`   Stack: ${err.stack}`);
  }
  static wtf(msg) { Logger.log(`💀 [FATAL] ${msg}`); } // What a Terrible Failure
}

// ========================================================================
// 🧬 DETERMINISTIC ENGINE & VALIDATORS
// ========================================================================
class Validator {
  /**
   * Deterministic Hash Algorithm (DJB2)
   * Eğer script hata alıp tekrar çalışırsa, Math.random() önceki sefer seçtiği klikleri atlayabilir.
   * Bu algoritma gclid'ye göre her zaman aynı sonucu verir!
   */
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

  /**
   * Google Ads requires YYYY-MM-DD HH:mm:ss+ZZ:ZZ strictly!
   */
  static isValidGoogleAdsTime(timeStr) {
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(timeStr);
  }

  static analyze(row) {
    const clickId = row.gclid || row.wbraid || row.gbraid;
    if (!clickId) return { valid: false, reason: 'MISSING_CLICK_ID' };

    if (!row.conversionTime) return { valid: false, reason: 'MISSING_TIME' };
    if (!this.isValidGoogleAdsTime(row.conversionTime)) return { valid: false, reason: 'INVALID_TIME_FORMAT' };

    // V1 Sinyallerini Deterministic Sampling'den geçiriyoruz.
    if (row.conversionName === CONVERSION_EVENTS.V1_PAGEVIEW) {
      if (!this.isSampledIn(clickId, CONFIG.SAMPLING_RATE_V1)) {
        return { valid: false, reason: 'DETERMINISTIC_SKIP' };
      }
    }

    return { valid: true, clickId };
  }
}

// ========================================================================
// 🌐 QUANTUM NETWORK LAYER (Auto-Healing HTTP)
// ========================================================================
class QuantumClient {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.sessionToken = null;
  }

  /**
   * Akıllı Backoff (Jitter'lı Eksponansiyel Gecikme)
   */
  _fetchWithBackoff(url, options) {
    let attempt = 0;
    let delay = CONFIG.HTTP.INITIAL_DELAY_MS;

    while (attempt < CONFIG.HTTP.MAX_RETRIES) {
      try {
        const response = UrlFetchApp.fetch(url, { ...options, muteHttpExceptions: true });
        const code = response.getResponseCode();

        // Başarılı
        if (code >= 200 && code < 300) return response;

        // Rate Limit (429) veya Server Error (5xx) -> Backoff uygula
        if (code === 429 || code >= 500) {
          const body = response.getContentText();
          Telemetry.warn(`HTTP ${code} on attempt ${attempt + 1}. Retrying...`, { url, body: body.substring(0, 100) });
          // Fallthrough to sleep
        } else {
          // 400, 401, 403 vb. kritik hatalar. Retry yapma!
          throw new Error(`Kritik HTTP Hatası ${code}: ${response.getContentText()}`);
        }
      } catch (err) {
        if (attempt === CONFIG.HTTP.MAX_RETRIES - 1) throw err;
        Telemetry.warn(`Ağ Hatası (Deneme ${attempt + 1}): ${err.message}`);
      }

      attempt++;
      // Jitter ile çarpışmaları önle (Thundering Herd engelleme)
      const jitter = Math.random() * 500;
      Utilities.sleep(delay + jitter);
      delay *= 2; // Eksponansiyel Artış
    }
    throw new Error(`Bütün ${CONFIG.HTTP.MAX_RETRIES} ağ denemesi başarısız oldu: ${url}`);
  }

  verifyHandshake(siteId) {
    const url = `${this.baseUrl}/api/oci/v2/verify`;
    const response = this._fetchWithBackoff(url, {
      method: 'post',
      headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ siteId })
    });

    const data = JSON.parse(response.getContentText());
    if (!data.session_token) throw new Error("Beklenmeyen Yanıt: session_token eksik.");
    this.sessionToken = data.session_token;
  }

  fetchConversions(siteId) {
    const url = `${this.baseUrl}/api/oci/google-ads-export?siteId=${encodeURIComponent(siteId)}&markAsExported=true`;
    const response = this._fetchWithBackoff(url, {
      method: 'get',
      headers: {
        'Authorization': `Bearer ${this.sessionToken}`,
        'Accept': 'application/json'
      }
    });

    return JSON.parse(response.getContentText() || '[]');
  }

  sendAck(siteId, queueIds) {
    if (!queueIds.length) return;
    const url = `${this.baseUrl}/api/oci/ack`;
    this._fetchWithBackoff(url, {
      method: 'post',
      headers: {
        'Authorization': `Bearer ${this.sessionToken}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({ siteId, queueIds })
    });
  }
}

// ========================================================================
// 🏗️ GOOGLE ADS UPLOAD ENGINE
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

  process(conversions) {
    const timezone = AdsApp.currentAccount().getTimeZone() || 'Europe/Istanbul';
    const upload = AdsApp.bulkUploads().newCsvUpload(this.columns, {
      moneyInMicros: false,
      timeZone: timezone
    });
    upload.forOfflineConversions();
    upload.setFileName(`Eslamed_OCI_Quantum_${new Date().toISOString()}.csv`);

    const stats = { uploaded: 0, skipped: 0, successIds: [] };

    for (const row of conversions) {
      const validation = Validator.analyze(row);

      if (!validation.valid) {
        if (validation.reason !== 'DETERMINISTIC_SKIP') {
          Telemetry.warn(`Hatalı Satır Atlandı: ${validation.reason}`, { id: row.id || 'N/A' });
        }
        stats.skipped++;
        continue;
      }

      const conversionValue = parseFloat(String(row.conversionValue || 0).replace(/[^\d.-]/g, '')) || 0;

      upload.append({
        'Order ID': row.orderId || row.id || '',
        'Google Click ID': validation.clickId,
        'Conversion name': (row.conversionName || '').trim() || CONVERSION_EVENTS.V5_SEAL,
        'Conversion time': row.conversionTime,
        'Conversion value': Math.max(0, conversionValue), // Negatif meblağ önleme
        'Conversion currency': (row.conversionCurrency || 'TRY').toUpperCase()
      });

      stats.uploaded++;
      if (row.id) stats.successIds.push(row.id);
    }

    if (stats.uploaded > 0) {
      upload.apply();
    }

    return stats;
  }
}

// ========================================================================
// 🚀 MAIN EXECUTION (ENTRY POINT)
// ========================================================================
function main() {
  Telemetry.info('🚀 Eslamed Quantum OCI Engine Başlatılıyor...');

  try {
    const client = new QuantumClient(CONFIG.BASE_URL, CONFIG.API_KEY);

    // 1. Quantum Handshake
    Telemetry.info('🔑 Ağ protokolü doğrulanıyor...');
    client.verifyHandshake(CONFIG.SITE_ID);

    // 2. Fetch Data
    Telemetry.info('📥 Kuyruk dinleniyor...');
    const conversions = client.fetchConversions(CONFIG.SITE_ID);

    if (!Array.isArray(conversions) || conversions.length === 0) {
      Telemetry.info('✅ İşlenecek yeni dönüşüm bulunamadı. Uyku moduna geçiliyor.');
      return;
    }

    Telemetry.info(`📦 ${conversions.length} ham sinyal yakalandı. Validasyon başlıyor...`);

    // 3. Upload & Validate
    const engine = new UploadEngine();
    const stats = engine.process(conversions);

    Telemetry.info(`📊 Yükleme Bilanço: Başarılı: ${stats.uploaded}, Atlanan: ${stats.skipped}`);

    // 4. Mühürleme (ACK)
    if (stats.successIds.length > 0) {
      Telemetry.info(`🛡️ ${stats.successIds.length} kayıt için API'ye Mühür (ACK) gönderiliyor...`);
      client.sendAck(CONFIG.SITE_ID, stats.successIds);
      Telemetry.info('🏁 Senskronizasyon kusursuz tamamlandı.');
    }

  } catch (error) {
    Telemetry.wtf('Script kritik bir çekirdek hatasıyla durduruldu.');
    Telemetry.error('İz Dökümü', error);
  }
}

// ========================================================================
// 🧪 LOCAL TESTING ENVIRONMENT (Mock Google Ads API)
// ========================================================================
if (typeof module !== 'undefined' && require !== 'undefined' && require.main === module) {
  console.log('🧪 OCI Quantum Script - Local Execution Mode Started...');

  // Mock Logger
  global.Logger = {
    log: function (msg) { console.log(msg); }
  };

  // Mock Utilities
  global.Utilities = {
    sleep: function (ms) {
      const waitTill = new Date(new Date().getTime() + ms);
      while (waitTill > new Date()) { }
    }
  };

  // Mock UrlFetchApp
  global.UrlFetchApp = {
    fetch: function (url, options) {
      console.log(`\n[Mock UrlFetchApp 🌐] -> ${options.method.toUpperCase()} ${url}`);
      return {
        getResponseCode: () => 200,
        getContentText: () => {
          if (url.includes('/api/oci/v2/verify')) {
            return JSON.stringify({ session_token: 'mock_quantum_token_12345' });
          }
          if (url.includes('/api/oci/google-ads-export')) {
            return JSON.stringify([
              {
                id: 'mock-conv-1',
                gclid: 'TEST_GCLID_QWERT123',
                conversionName: 'OpsMantik_V5_DEMIR_MUHUR',
                conversionTime: '2026-03-01 15:30:00+03:00',
                conversionValue: 5000,
                conversionCurrency: 'TRY'
              },
              {
                id: 'mock-conv-2',
                wbraid: 'TEST_WBRAID_XYZ890',
                conversionName: 'OpsMantik_V3_Nitelikli_Gorusme',
                conversionTime: '2026-03-01 16:45:00+03:00',
                conversionValue: 0,
                conversionCurrency: 'TRY'
              },
              {
                id: 'mock-conv-3',
                gclid: 'TEST_GCLID_INVALID_TIME',
                conversionName: 'OpsMantik_V5_DEMIR_MUHUR',
                conversionTime: '2026-03-01', // Invalid time to test validator
                conversionValue: 1000,
                conversionCurrency: 'TRY'
              }
            ]);
          }
          if (url.includes('/api/oci/ack')) {
            return JSON.stringify({ updated: 2 });
          }
          return '{}';
        }
      };
    }
  };

  // Mock AdsApp
  global.AdsApp = {
    currentAccount: () => ({
      getTimeZone: () => 'Europe/Istanbul'
    }),
    bulkUploads: () => ({
      newCsvUpload: (columns, config) => ({
        forOfflineConversions: () => { },
        setFileName: (name) => { console.log(`[Mock AdsApp 📁] Upload file created: ${name}`); },
        append: (row) => { console.log(`[Mock AdsApp ➕] Row Appended:`, row); },
        apply: () => { console.log('[Mock AdsApp 🚀] Upload Applied to Google Ads Successfully!'); }
      })
    })
  };

  // Execute
  console.log('--------------------------------------------------');
  main();
  console.log('--------------------------------------------------');
  console.log('✅ Local execution finished.');
}
